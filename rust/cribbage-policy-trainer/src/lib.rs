//! Offline external-sampling MCCFR trainer for model 16 pegging.
//!
//! The engine's exact information-set key remains the legality boundary. The
//! learned policy deliberately groups exact legal views by observable pegging
//! features that recur often enough to train: retained ranks, revealed play,
//! current-series order, go/last state, role, and board pressure. Cut and
//! private discard ranks are omitted from this learned-table abstraction; this
//! can trade a small amount of card-depletion precision for useful coverage,
//! but it cannot expose an opponent's hidden hand.

use cribbage_shadow_engine::board::{BoardModel, Role, ScorePhase};
use cribbage_shadow_engine::cards::{
    combinations_indices, full_deck, rank_counts, score_hand, Card,
};
use cribbage_shadow_engine::information_set::{
    PegSeat, PolicyInformationSetKey, RankPegAction, RankPegState, PACKED_POLICY_KEY_BYTES,
    POLICY_ACTION_COUNT,
};
use cribbage_shadow_engine::policy::{
    PolicyArtifact, PolicyArtifactMetadata, QuantizedPolicyEntry, POLICY_WEIGHT_TOTAL,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;

pub const ACTION_COUNT: usize = POLICY_ACTION_COUNT;
const GO_ACTION: usize = 13;
const CHECKPOINT_MAGIC: &[u8; 8] = b"C16CFR02";
const CHECKPOINT_VERSION: u32 = 7;
const TABLE_SHARDS: usize = 64;

#[derive(Clone, Debug)]
pub struct TrainingCorpus {
    deals: Vec<TrainingDeal>,
    checksum: u64,
}

impl TrainingCorpus {
    pub fn load_tsv(path: &Path) -> Result<TrainingCorpus, String> {
        let bytes = fs::read(path).map_err(|error| {
            format!("read training corpus {} failed: {}", path.display(), error)
        })?;
        let text = std::str::from_utf8(&bytes)
            .map_err(|_| format!("training corpus {} is not UTF-8", path.display()))?;
        let mut deals = Vec::new();
        for (index, line) in text.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            deals.push(parse_training_corpus_line(line, index + 1)?);
        }
        if deals.is_empty() {
            return Err(format!("training corpus {} is empty", path.display()));
        }
        Ok(TrainingCorpus {
            deals,
            checksum: fnv1a64(&bytes),
        })
    }

    pub fn len(&self) -> usize {
        self.deals.len()
    }

    pub fn is_empty(&self) -> bool {
        self.deals.is_empty()
    }

    pub fn checksum(&self) -> u64 {
        self.checksum
    }

    fn sample(&self, rng: &mut TrainingRng) -> TrainingDeal {
        self.deals[rng.range(self.deals.len() as u64) as usize].clone()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct PolicyNode {
    pub legal_mask: u16,
    pub regrets: [f64; ACTION_COUNT],
    pub strategy_sum: [f64; ACTION_COUNT],
    pub visits: u64,
    pub strategy_visits: u64,
}

impl PolicyNode {
    fn new(legal_mask: u16) -> PolicyNode {
        PolicyNode {
            legal_mask,
            regrets: [0.0; ACTION_COUNT],
            strategy_sum: [0.0; ACTION_COUNT],
            visits: 0,
            strategy_visits: 0,
        }
    }

    pub fn current_strategy(&self) -> [f64; ACTION_COUNT] {
        normalized_positive(&self.regrets, self.legal_mask)
    }

    pub fn average_strategy(&self) -> [f64; ACTION_COUNT] {
        normalized_positive(&self.strategy_sum, self.legal_mask)
    }
}

#[derive(Clone, Debug)]
pub struct Checkpoint {
    pub seed: u64,
    pub iterations: u64,
    pub nodes: Vec<(PolicyInformationSetKey, PolicyNode)>,
    pub pending_fingerprints: Vec<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CheckpointStatistics {
    pub regret_updates: u64,
    pub average_strategy_samples: u64,
    pub positive_regret_per_update: f64,
    pub max_positive_regret_per_update: f64,
    pub mean_normalized_policy_entropy: f64,
}

impl Checkpoint {
    pub fn checksum(&self) -> u64 {
        fnv1a64(&self.to_bytes())
    }

    pub fn checksum_hex(&self) -> String {
        format!("{:016x}", self.checksum())
    }

    /// Lightweight convergence diagnostics. These are sampled-CFR regret
    /// proxies, not an exact exploitability bound for the full cribbage game.
    pub fn statistics(&self) -> CheckpointStatistics {
        let mut regret_updates = 0_u64;
        let mut average_strategy_samples = 0_u64;
        let mut positive_regret = 0.0;
        let mut max_positive_regret = 0.0;
        let mut normalized_entropy = 0.0;
        let mut entropy_nodes = 0_u64;
        for (_, node) in &self.nodes {
            regret_updates = regret_updates.saturating_add(node.visits);
            average_strategy_samples =
                average_strategy_samples.saturating_add(node.strategy_visits);
            let mut node_max: f64 = 0.0;
            let mut legal_actions = 0_u32;
            for (action, regret) in node.regrets.iter().enumerate() {
                if node.legal_mask & (1 << action) == 0 {
                    continue;
                }
                legal_actions += 1;
                let positive = regret.max(0.0);
                positive_regret += positive;
                node_max = node_max.max(positive);
            }
            max_positive_regret += node_max;
            if legal_actions > 1 {
                let strategy = export_strategy(node);
                let entropy = strategy
                    .iter()
                    .filter(|probability| **probability > 0.0)
                    .map(|probability| -*probability * probability.ln())
                    .sum::<f64>()
                    / f64::from(legal_actions).ln();
                normalized_entropy += entropy;
                entropy_nodes += 1;
            }
        }
        let update_denominator = regret_updates.max(1) as f64;
        CheckpointStatistics {
            regret_updates,
            average_strategy_samples,
            positive_regret_per_update: positive_regret / update_denominator,
            max_positive_regret_per_update: max_positive_regret / update_denominator,
            mean_normalized_policy_entropy: if entropy_nodes == 0 {
                0.0
            } else {
                normalized_entropy / entropy_nodes as f64
            },
        }
    }

    pub fn save(&self, path: &Path) -> Result<(), String> {
        let bytes = self.to_bytes();
        let parent = path.parent().unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent)
            .map_err(|error| format!("create {} failed: {}", parent.display(), error))?;
        let temporary = path.with_extension("tmp");
        let mut file = fs::File::create(&temporary)
            .map_err(|error| format!("create {} failed: {}", temporary.display(), error))?;
        file.write_all(&bytes)
            .map_err(|error| format!("write {} failed: {}", temporary.display(), error))?;
        file.sync_all()
            .map_err(|error| format!("sync {} failed: {}", temporary.display(), error))?;
        fs::rename(&temporary, path).map_err(|error| {
            format!(
                "rename {} to {} failed: {}",
                temporary.display(),
                path.display(),
                error
            )
        })
    }

    pub fn load(path: &Path) -> Result<Checkpoint, String> {
        let bytes =
            fs::read(path).map_err(|error| format!("read {} failed: {}", path.display(), error))?;
        Checkpoint::from_bytes(&bytes)
    }

    fn to_bytes(&self) -> Vec<u8> {
        let mut nodes = self.nodes.clone();
        nodes.sort_by_key(|(key, _)| key.to_packed_bytes());
        let mut pending_fingerprints = self.pending_fingerprints.clone();
        pending_fingerprints.sort_unstable();
        let mut bytes = Vec::with_capacity(40 + nodes.len() * 120 + pending_fingerprints.len() * 8);
        bytes.extend_from_slice(CHECKPOINT_MAGIC);
        bytes.extend_from_slice(&CHECKPOINT_VERSION.to_le_bytes());
        bytes.extend_from_slice(&self.seed.to_le_bytes());
        bytes.extend_from_slice(&self.iterations.to_le_bytes());
        bytes.extend_from_slice(&(nodes.len() as u64).to_le_bytes());
        bytes.extend_from_slice(&(pending_fingerprints.len() as u64).to_le_bytes());
        for (key, node) in nodes {
            bytes.extend_from_slice(&key.to_packed_bytes());
            bytes.extend_from_slice(&node.legal_mask.to_le_bytes());
            bytes.extend_from_slice(&node.visits.to_le_bytes());
            bytes.extend_from_slice(&node.strategy_visits.to_le_bytes());
            for action in 0..ACTION_COUNT {
                if node.legal_mask & (1 << action) != 0 {
                    bytes.extend_from_slice(&node.regrets[action].to_le_bytes());
                    bytes.extend_from_slice(&node.strategy_sum[action].to_le_bytes());
                }
            }
        }
        for fingerprint in pending_fingerprints {
            bytes.extend_from_slice(&fingerprint.to_le_bytes());
        }
        bytes
    }

    fn from_bytes(bytes: &[u8]) -> Result<Checkpoint, String> {
        let mut cursor = ByteCursor::new(bytes);
        if cursor.take(8)? != CHECKPOINT_MAGIC {
            return Err("invalid checkpoint magic".to_string());
        }
        let version = cursor.u32()?;
        if version != CHECKPOINT_VERSION {
            return Err(format!("unsupported checkpoint version {}", version));
        }
        let seed = cursor.u64()?;
        let iterations = cursor.u64()?;
        let node_count = cursor.u64()?;
        let pending_count = cursor.u64()?;
        let mut nodes = Vec::with_capacity(node_count.min(usize::MAX as u64) as usize);
        for _ in 0..node_count {
            let key =
                PolicyInformationSetKey::from_packed_bytes(cursor.take(PACKED_POLICY_KEY_BYTES)?)?;
            let legal_mask = cursor.u16()?;
            validate_legal_mask(legal_mask)?;
            let visits = cursor.u64()?;
            let strategy_visits = cursor.u64()?;
            let mut regrets = [0.0; ACTION_COUNT];
            let mut strategy_sum = [0.0; ACTION_COUNT];
            for action in 0..ACTION_COUNT {
                if legal_mask & (1 << action) != 0 {
                    regrets[action] = cursor.f64()?;
                    strategy_sum[action] = cursor.f64()?;
                }
            }
            if regrets
                .iter()
                .chain(strategy_sum.iter())
                .any(|value| !value.is_finite())
            {
                return Err("checkpoint contains a non-finite policy value".to_string());
            }
            nodes.push((
                key,
                PolicyNode {
                    legal_mask,
                    regrets,
                    strategy_sum,
                    visits,
                    strategy_visits,
                },
            ));
        }
        let mut pending_fingerprints =
            Vec::with_capacity(pending_count.min(usize::MAX as u64) as usize);
        for _ in 0..pending_count {
            pending_fingerprints.push(cursor.u64()?);
        }
        pending_fingerprints.sort_unstable();
        if pending_fingerprints
            .windows(2)
            .any(|pair| pair[0] == pair[1])
        {
            return Err("checkpoint contains a duplicate pending fingerprint".to_string());
        }
        if cursor.remaining() != 0 {
            return Err(format!(
                "checkpoint has {} unexpected trailing bytes",
                cursor.remaining()
            ));
        }
        Ok(Checkpoint {
            seed,
            iterations,
            nodes,
            pending_fingerprints,
        })
    }
}

/// Convert a training checkpoint into the compact, runtime-readable average
/// policy. Nodes below `minimum_visits` remain covered by the documented
/// runtime backoff instead of consuming artifact space on weak evidence.
pub fn build_policy_artifact(
    checkpoint: &Checkpoint,
    minimum_visits: u64,
    provenance: String,
) -> Result<PolicyArtifact, String> {
    if minimum_visits == 0 {
        return Err("minimum policy visits must be greater than zero".to_string());
    }
    if provenance.trim().is_empty() {
        return Err("policy provenance must not be empty".to_string());
    }

    let mut entries = Vec::new();
    for (key, node) in &checkpoint.nodes {
        let evidence = node.visits.saturating_add(node.strategy_visits);
        if evidence < minimum_visits {
            continue;
        }
        validate_legal_mask(node.legal_mask)?;
        if node.legal_mask != key.expected_legal_mask() {
            return Err(format!(
                "checkpoint legal mask {:#x} does not match policy key {:#x}",
                node.legal_mask,
                key.expected_legal_mask()
            ));
        }
        let strategy = export_strategy(node);
        entries.push(QuantizedPolicyEntry {
            key: *key,
            legal_mask: node.legal_mask,
            confidence: evidence.min(u64::from(u32::MAX)) as u32,
            weights: quantize_strategy(&strategy, node.legal_mask)?,
        });
    }

    PolicyArtifact::new(
        PolicyArtifactMetadata {
            training_seed: checkpoint.seed,
            training_iterations: checkpoint.iterations,
            checkpoint_checksum: checkpoint.checksum(),
            source_nodes: checkpoint.nodes.len() as u64,
            source_singletons: checkpoint.pending_fingerprints.len() as u64,
            included_entries: 0,
            minimum_visits,
            provenance,
            backoff: "model16 legal-information heuristic for missing keys".to_string(),
        },
        entries,
    )
}

fn export_strategy(node: &PolicyNode) -> [f64; ACTION_COUNT] {
    let average_total = node
        .strategy_sum
        .iter()
        .enumerate()
        .filter(|(action, _)| node.legal_mask & (1 << action) != 0)
        .map(|(_, value)| value.max(0.0))
        .sum::<f64>();
    if average_total > 0.0 {
        node.average_strategy()
    } else {
        node.current_strategy()
    }
}

fn quantize_strategy(
    strategy: &[f64; ACTION_COUNT],
    legal_mask: u16,
) -> Result<[u16; ACTION_COUNT], String> {
    validate_legal_mask(legal_mask)?;
    let mut total = 0.0;
    for (action, probability) in strategy.iter().enumerate() {
        if !probability.is_finite() || *probability < 0.0 {
            return Err(format!("invalid policy probability at action {}", action));
        }
        if legal_mask & (1 << action) != 0 {
            total += *probability;
        } else if *probability != 0.0 {
            return Err(format!("illegal action {} has policy probability", action));
        }
    }
    if total <= 0.0 {
        return Err("policy strategy has no legal probability mass".to_string());
    }

    let mut weights = [0_u16; ACTION_COUNT];
    let mut used = 0_u32;
    let mut remainders = Vec::new();
    for (action, probability) in strategy.iter().enumerate() {
        if legal_mask & (1 << action) == 0 {
            continue;
        }
        let exact = (*probability / total) * f64::from(POLICY_WEIGHT_TOTAL);
        let floor = exact.floor() as u32;
        if floor > u32::from(u16::MAX) {
            return Err("policy quantization overflow".to_string());
        }
        weights[action] = floor as u16;
        used = used
            .checked_add(floor)
            .ok_or_else(|| "policy quantization overflow".to_string())?;
        remainders.push((action, exact - f64::from(floor)));
    }
    if used > POLICY_WEIGHT_TOTAL {
        return Err("policy quantization exceeded its weight total".to_string());
    }
    remainders.sort_by(
        |(left_action, left_fraction), (right_action, right_fraction)| {
            right_fraction
                .total_cmp(left_fraction)
                .then_with(|| left_action.cmp(right_action))
        },
    );
    for index in 0..(POLICY_WEIGHT_TOTAL - used) as usize {
        let action = remainders[index % remainders.len()].0;
        weights[action] = weights[action]
            .checked_add(1)
            .ok_or_else(|| "policy quantization overflow".to_string())?;
    }
    Ok(weights)
}

#[derive(Default)]
struct PolicyShard {
    nodes: HashMap<PolicyInformationSetKey, PolicyNode>,
    // A singleton needs only a stable fingerprint. On its next encounter it
    // is promoted to a full regret node, keeping one-use states inexpensive.
    pending_fingerprints: HashSet<u64>,
}

pub struct SharedTrainer {
    shards: Vec<Mutex<PolicyShard>>,
}

impl SharedTrainer {
    pub fn new() -> SharedTrainer {
        SharedTrainer {
            shards: (0..TABLE_SHARDS)
                .map(|_| Mutex::new(PolicyShard::default()))
                .collect(),
        }
    }

    pub fn from_checkpoint(checkpoint: &Checkpoint) -> Result<SharedTrainer, String> {
        let trainer = SharedTrainer::new();
        let mut trained_fingerprints = checkpoint
            .nodes
            .iter()
            .map(|(key, _)| policy_key_fingerprint(key))
            .collect::<Vec<_>>();
        trained_fingerprints.sort_unstable();
        for (key, node) in &checkpoint.nodes {
            validate_legal_mask(node.legal_mask)?;
            let shard = trainer.shard(key);
            let replaced = trainer.shards[shard]
                .lock()
                .map_err(|_| "policy shard lock poisoned".to_string())?
                .nodes
                .insert(*key, node.clone());
            if replaced.is_some() {
                return Err("checkpoint contains a duplicate information set".to_string());
            }
        }
        for fingerprint in &checkpoint.pending_fingerprints {
            if trained_fingerprints.binary_search(fingerprint).is_ok() {
                return Err("checkpoint marks a trained information set as pending".to_string());
            }
            let shard_index = trainer.shard_for_fingerprint(*fingerprint);
            let mut shard = trainer.shards[shard_index]
                .lock()
                .map_err(|_| "policy shard lock poisoned".to_string())?;
            if !shard.pending_fingerprints.insert(*fingerprint) {
                return Err("checkpoint contains a duplicate pending fingerprint".to_string());
            }
        }
        Ok(trainer)
    }

    pub fn train_range(
        &self,
        seed: u64,
        start_iteration: u64,
        end_iteration: u64,
        workers: usize,
    ) -> Result<(), String> {
        self.train_range_with_corpus(seed, start_iteration, end_iteration, workers, None)
    }

    pub fn train_range_with_corpus(
        &self,
        seed: u64,
        start_iteration: u64,
        end_iteration: u64,
        workers: usize,
        corpus: Option<&TrainingCorpus>,
    ) -> Result<(), String> {
        if end_iteration < start_iteration {
            return Err("training range ends before it starts".to_string());
        }
        if workers == 0 {
            return Err("worker count must be greater than zero".to_string());
        }
        let next = AtomicU64::new(start_iteration);
        let first_error = Mutex::new(None::<String>);
        thread::scope(|scope| {
            for _ in 0..workers {
                scope.spawn(|| {
                    let board = BoardUtility::new();
                    loop {
                        if first_error.lock().unwrap().is_some() {
                            break;
                        }
                        let iteration = next.fetch_add(1, Ordering::Relaxed);
                        if iteration >= end_iteration {
                            break;
                        }
                        let mut rng = TrainingRng::for_iteration(seed, iteration);
                        let deal = corpus
                            .map(|corpus| corpus.sample(&mut rng))
                            .unwrap_or_else(|| sample_training_deal(&mut rng));
                        let traverser = if iteration.is_multiple_of(2) {
                            PegSeat::Zero
                        } else {
                            PegSeat::One
                        };
                        let mut state = deal.initial_state();
                        let result = if state.winner.is_some() {
                            Ok(terminal_utility(&state, &deal, traverser, &board))
                        } else {
                            traverse(self, &mut state, &deal, traverser, 1.0, &mut rng, &board)
                        };
                        if let Err(error) = result {
                            *first_error.lock().unwrap() =
                                Some(format!("iteration {} failed: {}", iteration, error));
                            break;
                        }
                    }
                });
            }
        });
        if let Some(error) = first_error.into_inner().unwrap() {
            Err(error)
        } else {
            Ok(())
        }
    }

    pub fn checkpoint(&self, seed: u64, iterations: u64) -> Result<Checkpoint, String> {
        let mut nodes = Vec::new();
        let mut pending_fingerprints = Vec::new();
        for shard in &self.shards {
            let shard = shard
                .lock()
                .map_err(|_| "policy shard lock poisoned".to_string())?;
            nodes.extend(shard.nodes.iter().map(|(key, node)| (*key, node.clone())));
            pending_fingerprints.extend(shard.pending_fingerprints.iter().copied());
        }
        nodes.sort_by_key(|(key, _)| key.to_packed_bytes());
        pending_fingerprints.sort_unstable();
        Ok(Checkpoint {
            seed,
            iterations,
            nodes,
            pending_fingerprints,
        })
    }

    pub fn node_count(&self) -> usize {
        self.shards
            .iter()
            .map(|shard| shard.lock().unwrap().nodes.len())
            .sum()
    }

    pub fn pending_count(&self) -> usize {
        self.shards
            .iter()
            .map(|shard| shard.lock().unwrap().pending_fingerprints.len())
            .sum()
    }

    pub fn information_set_count(&self) -> usize {
        self.node_count() + self.pending_count()
    }

    fn shard(&self, key: &PolicyInformationSetKey) -> usize {
        self.shard_for_fingerprint(policy_key_fingerprint(key))
    }

    fn shard_for_fingerprint(&self, fingerprint: u64) -> usize {
        fingerprint as usize % self.shards.len()
    }

    fn strategy(
        &self,
        key: PolicyInformationSetKey,
        legal_mask: u16,
    ) -> Result<[f64; ACTION_COUNT], String> {
        let shard_index = self.shard(&key);
        let mut shard = self.shards[shard_index]
            .lock()
            .map_err(|_| "policy shard lock poisoned".to_string())?;
        if let Some(node) = shard.nodes.get(&key) {
            ensure_same_legal_mask(node, legal_mask)?;
            return Ok(node.current_strategy());
        }
        let fingerprint = policy_key_fingerprint(&key);
        if shard.pending_fingerprints.remove(&fingerprint) {
            let node = PolicyNode::new(legal_mask);
            let strategy = node.current_strategy();
            shard.nodes.insert(key, node);
            return Ok(strategy);
        } else {
            shard.pending_fingerprints.insert(fingerprint);
        }
        Ok(normalized_positive(&[0.0; ACTION_COUNT], legal_mask))
    }

    fn update_regrets(
        &self,
        key: PolicyInformationSetKey,
        legal_mask: u16,
        deltas: &[f64; ACTION_COUNT],
    ) -> Result<(), String> {
        let shard_index = self.shard(&key);
        let mut shard = self.shards[shard_index]
            .lock()
            .map_err(|_| "policy shard lock poisoned".to_string())?;
        let Some(node) = shard.nodes.get_mut(&key) else {
            return Ok(());
        };
        ensure_same_legal_mask(node, legal_mask)?;
        for (action, delta) in deltas.iter().enumerate() {
            if legal_mask & (1 << action) != 0 {
                node.regrets[action] += *delta;
            }
        }
        node.visits += 1;
        Ok(())
    }

    fn accumulate_average(
        &self,
        key: PolicyInformationSetKey,
        legal_mask: u16,
        strategy: &[f64; ACTION_COUNT],
        reach: f64,
    ) -> Result<(), String> {
        let shard_index = self.shard(&key);
        let mut shard = self.shards[shard_index]
            .lock()
            .map_err(|_| "policy shard lock poisoned".to_string())?;
        let Some(node) = shard.nodes.get_mut(&key) else {
            return Ok(());
        };
        ensure_same_legal_mask(node, legal_mask)?;
        for (action, probability) in strategy.iter().enumerate() {
            if legal_mask & (1 << action) != 0 {
                node.strategy_sum[action] += reach * *probability;
            }
        }
        node.strategy_visits += 1;
        Ok(())
    }
}

impl Default for SharedTrainer {
    fn default() -> Self {
        Self::new()
    }
}

fn policy_key_fingerprint(key: &PolicyInformationSetKey) -> u64 {
    fnv1a64(&key.to_packed_bytes())
}

fn traverse(
    trainer: &SharedTrainer,
    state: &mut RankPegState,
    deal: &TrainingDeal,
    traverser: PegSeat,
    opponent_reach: f64,
    rng: &mut TrainingRng,
    board: &BoardUtility,
) -> Result<f64, String> {
    if state.complete || state.winner.is_some() {
        return Ok(terminal_utility(state, deal, traverser, board));
    }
    let actor = state.current;
    let legal_actions = state.legal_actions();
    if legal_actions.is_empty() {
        return Err("nonterminal state has no legal actions".to_string());
    }
    let legal_mask = action_mask(&legal_actions)?;
    let key = PolicyInformationSetKey::from_state(state, actor)?;
    let strategy = trainer.strategy(key, legal_mask)?;

    if actor == traverser {
        let mut action_utilities = [0.0; ACTION_COUNT];
        let mut node_utility = 0.0;
        for action in legal_actions {
            let index = action_index(action)?;
            let mut child = state.clone();
            child.apply(action)?;
            let utility = traverse(
                trainer,
                &mut child,
                deal,
                traverser,
                opponent_reach,
                rng,
                board,
            )?;
            action_utilities[index] = utility;
            node_utility += strategy[index] * utility;
        }
        let mut regret_deltas = [0.0; ACTION_COUNT];
        for action in 0..ACTION_COUNT {
            if legal_mask & (1 << action) != 0 {
                regret_deltas[action] = action_utilities[action] - node_utility;
            }
        }
        trainer.update_regrets(key, legal_mask, &regret_deltas)?;
        Ok(node_utility)
    } else {
        trainer.accumulate_average(key, legal_mask, &strategy, opponent_reach)?;
        let sampled_index = sample_strategy(&strategy, legal_mask, rng);
        let action = index_action(sampled_index);
        state.apply(action)?;
        traverse(
            trainer,
            state,
            deal,
            traverser,
            opponent_reach * strategy[sampled_index],
            rng,
            board,
        )
    }
}

#[derive(Clone, Debug)]
struct TrainingDeal {
    retained: [Vec<Card>; 2],
    discards: [Vec<Card>; 2],
    crib: Vec<Card>,
    turn_card: Card,
    starting_scores: [i32; 2],
    dealer: PegSeat,
}

impl TrainingDeal {
    fn initial_state(&self) -> RankPegState {
        let mut scores = self.starting_scores;
        let mut winner = None;
        if self.turn_card.rank == 10 {
            let dealer = self.dealer.index();
            scores[dealer] = (scores[dealer] + 2).min(121);
            if scores[dealer] >= 121 {
                winner = Some(self.dealer);
            }
        }
        RankPegState {
            hands: [
                rank_counts(&self.retained[0]),
                rank_counts(&self.retained[1]),
            ],
            own_discards: [
                rank_counts(&self.discards[0]),
                rank_counts(&self.discards[1]),
            ],
            turn_rank: self.turn_card.rank,
            scores,
            dealer: self.dealer,
            current: self.dealer.other(),
            plays: Vec::new(),
            count: 0,
            go_player: None,
            last_player: None,
            history: Vec::new(),
            winner,
            complete: winner.is_some(),
        }
    }
}

fn parse_training_corpus_line(line: &str, line_number: usize) -> Result<TrainingDeal, String> {
    let fields = line.split('\t').collect::<Vec<_>>();
    if fields.len() != 9 {
        return Err(format!(
            "training corpus line {} has {} fields; expected 9",
            line_number,
            fields.len()
        ));
    }
    let dealer = match parse_corpus_u8(fields[0], line_number, "dealer")? {
        0 => PegSeat::Zero,
        1 => PegSeat::One,
        value => {
            return Err(format!(
                "training corpus line {} has invalid dealer {}",
                line_number, value
            ))
        }
    };
    let left_score = parse_corpus_i32(fields[1], line_number, "left score")?;
    let right_score = parse_corpus_i32(fields[2], line_number, "right score")?;
    if !(0..121).contains(&left_score) || !(0..121).contains(&right_score) {
        return Err(format!(
            "training corpus line {} scores must be in 0..121",
            line_number
        ));
    }
    let turn_card = compact_corpus_card(
        parse_corpus_u8(fields[3], line_number, "cut card")?,
        line_number,
    )?;
    let dealt = [
        parse_corpus_cards(fields[4], line_number, "left dealt", 6)?,
        parse_corpus_cards(fields[5], line_number, "right dealt", 6)?,
    ];
    let retained = [
        parse_corpus_cards(fields[6], line_number, "left keep", 4)?,
        parse_corpus_cards(fields[7], line_number, "right keep", 4)?,
    ];
    let crib = parse_corpus_cards(fields[8], line_number, "crib", 4)?;
    let discards = [
        corpus_discards(&dealt[0], &retained[0], line_number)?,
        corpus_discards(&dealt[1], &retained[1], line_number)?,
    ];
    let mut expected_crib = discards
        .iter()
        .flatten()
        .map(|card| card.id)
        .collect::<Vec<_>>();
    let mut actual_crib = crib.iter().map(|card| card.id).collect::<Vec<_>>();
    expected_crib.sort_unstable();
    actual_crib.sort_unstable();
    if expected_crib != actual_crib {
        return Err(format!(
            "training corpus line {} crib does not match the four discards",
            line_number
        ));
    }
    let unique_cards = dealt
        .iter()
        .flatten()
        .chain(std::iter::once(&turn_card))
        .map(|card| card.id)
        .collect::<HashSet<_>>();
    if unique_cards.len() != 13 {
        return Err(format!(
            "training corpus line {} does not contain 13 unique dealt/cut cards",
            line_number
        ));
    }
    Ok(TrainingDeal {
        retained,
        discards,
        crib,
        turn_card,
        starting_scores: [left_score, right_score],
        dealer,
    })
}

fn parse_corpus_u8(value: &str, line_number: usize, field: &str) -> Result<u8, String> {
    value.parse::<u8>().map_err(|error| {
        format!(
            "training corpus line {} invalid {} '{}': {}",
            line_number, field, value, error
        )
    })
}

fn parse_corpus_i32(value: &str, line_number: usize, field: &str) -> Result<i32, String> {
    value.parse::<i32>().map_err(|error| {
        format!(
            "training corpus line {} invalid {} '{}': {}",
            line_number, field, value, error
        )
    })
}

fn parse_corpus_cards(
    value: &str,
    line_number: usize,
    field: &str,
    expected: usize,
) -> Result<Vec<Card>, String> {
    if value.len() != expected * 2 || !value.len().is_multiple_of(2) {
        return Err(format!(
            "training corpus line {} {} has {} hex characters; expected {}",
            line_number,
            field,
            value.len(),
            expected * 2
        ));
    }
    (0..expected)
        .map(|index| {
            let offset = index * 2;
            let compact = u8::from_str_radix(&value[offset..offset + 2], 16).map_err(|error| {
                format!(
                    "training corpus line {} invalid {} hex: {}",
                    line_number, field, error
                )
            })?;
            compact_corpus_card(compact, line_number)
        })
        .collect()
}

fn compact_corpus_card(compact: u8, line_number: usize) -> Result<Card, String> {
    if compact >= 52 {
        return Err(format!(
            "training corpus line {} has compact card {} outside 0..52",
            line_number, compact
        ));
    }
    let rank = compact / 4;
    let suit = compact % 4;
    Card::new(suit * 13 + rank)
}

fn corpus_discards(
    dealt: &[Card],
    retained: &[Card],
    line_number: usize,
) -> Result<Vec<Card>, String> {
    let retained_ids = retained.iter().map(|card| card.id).collect::<HashSet<_>>();
    if retained_ids.len() != retained.len()
        || retained_ids
            .iter()
            .any(|id| !dealt.iter().any(|card| card.id == *id))
    {
        return Err(format!(
            "training corpus line {} keep is not a unique subset of dealt cards",
            line_number
        ));
    }
    let discards = dealt
        .iter()
        .copied()
        .filter(|card| !retained_ids.contains(&card.id))
        .collect::<Vec<_>>();
    if discards.len() != 2 {
        return Err(format!(
            "training corpus line {} does not derive exactly two discards",
            line_number
        ));
    }
    Ok(discards)
}

fn sample_training_deal(rng: &mut TrainingRng) -> TrainingDeal {
    let mut deck = full_deck();
    rng.shuffle(&mut deck);
    let dealer = if rng.range(2) == 0 {
        PegSeat::Zero
    } else {
        PegSeat::One
    };
    let pone = dealer.other();
    let mut dealt = [Vec::new(), Vec::new()];
    dealt[dealer.index()] = deck[0..6].to_vec();
    dealt[pone.index()] = deck[6..12].to_vec();
    let turn_card = deck[12];
    let mut retained = [Vec::new(), Vec::new()];
    let mut discards = [Vec::new(), Vec::new()];
    for seat in [PegSeat::Zero, PegSeat::One] {
        let (keep, discard) = select_discards(&dealt[seat.index()], seat == dealer);
        retained[seat.index()] = keep;
        discards[seat.index()] = discard;
    }
    let crib = discards[dealer.index()]
        .iter()
        .chain(discards[pone.index()].iter())
        .copied()
        .collect();
    TrainingDeal {
        retained,
        discards,
        crib,
        turn_card,
        starting_scores: [rng.range(121) as i32, rng.range(121) as i32],
        dealer,
    }
}

fn select_discards(six: &[Card], dealer: bool) -> (Vec<Card>, Vec<Card>) {
    debug_assert_eq!(six.len(), 6);
    let unseen = full_deck()
        .into_iter()
        .filter(|card| !six.iter().any(|known| known.id == card.id))
        .collect::<Vec<_>>();
    let mut best: Option<(i64, Vec<Card>, Vec<Card>)> = None;
    for keep_indices in combinations_indices(6, 4) {
        let keep = keep_indices
            .iter()
            .map(|index| six[*index])
            .collect::<Vec<_>>();
        let discard = six
            .iter()
            .enumerate()
            .filter(|(index, _)| !keep_indices.contains(index))
            .map(|(_, card)| *card)
            .collect::<Vec<_>>();
        let hand_total = unseen
            .iter()
            .map(|turn| i64::from(score_hand(&keep, *turn, false)))
            .sum::<i64>();
        let crib_hint = discard_pair_hint(&discard);
        let score = hand_total * 16 + if dealer { crib_hint } else { -crib_hint };
        let replace = best
            .as_ref()
            .map(|(best_score, best_keep, _)| {
                score > *best_score
                    || (score == *best_score && card_ids(&keep) < card_ids(best_keep))
            })
            .unwrap_or(true);
        if replace {
            best = Some((score, keep, discard));
        }
    }
    let (_, keep, discard) = best.expect("six cards always have a discard choice");
    (keep, discard)
}

fn discard_pair_hint(discard: &[Card]) -> i64 {
    let first = discard[0];
    let second = discard[1];
    let mut hint = 0;
    if first.rank == second.rank {
        hint += 64;
    }
    if first.value + second.value == 15 {
        hint += 64;
    }
    let distance = first.rank.abs_diff(second.rank);
    if distance <= 2 {
        hint += i64::from(3 - distance) * 12;
    }
    hint
}

fn card_ids(cards: &[Card]) -> Vec<u8> {
    cards.iter().map(|card| card.id).collect()
}

fn terminal_utility(
    state: &RankPegState,
    deal: &TrainingDeal,
    perspective: PegSeat,
    board: &BoardUtility,
) -> f64 {
    if let Some(winner) = state.winner {
        return if winner == perspective { 1.0 } else { -1.0 };
    }
    let mut scores = state.scores;
    let pone = deal.dealer.other();
    let ordered_scores = [
        (
            pone,
            i32::from(score_hand(
                &deal.retained[pone.index()],
                deal.turn_card,
                false,
            )),
        ),
        (
            deal.dealer,
            i32::from(score_hand(
                &deal.retained[deal.dealer.index()],
                deal.turn_card,
                false,
            )),
        ),
        (
            deal.dealer,
            i32::from(score_hand(&deal.crib, deal.turn_card, true)),
        ),
    ];
    for (scorer, points) in ordered_scores {
        scores[scorer.index()] = (scores[scorer.index()] + points).min(121);
        if scores[scorer.index()] >= 121 {
            return if scorer == perspective { 1.0 } else { -1.0 };
        }
    }
    let next_dealer = deal.dealer.other();
    let next_role = if perspective == next_dealer {
        Role::Dealer
    } else {
        Role::Pone
    };
    let probability = board.probability(
        scores[perspective.index()],
        scores[perspective.other().index()],
        next_role,
    );
    probability.mul_add(2.0, -1.0)
}

struct BoardUtility {
    values: Vec<f64>,
}

impl BoardUtility {
    fn new() -> BoardUtility {
        let mut board = BoardModel::new();
        let mut values = vec![0.0; 122 * 122 * 2];
        for role in [Role::Pone, Role::Dealer] {
            for my_score in 0..=121 {
                for opponent_score in 0..=121 {
                    values[board_utility_index(my_score, opponent_score, role)] = board
                        .future_win_probability_from_scores(
                            my_score,
                            opponent_score,
                            role,
                            ScorePhase::PeggingPone,
                        );
                }
            }
        }
        BoardUtility { values }
    }

    fn probability(&self, my_score: i32, opponent_score: i32, role: Role) -> f64 {
        self.values[board_utility_index(my_score.clamp(0, 121), opponent_score.clamp(0, 121), role)]
    }
}

fn board_utility_index(my_score: i32, opponent_score: i32, role: Role) -> usize {
    ((my_score as usize * 122 + opponent_score as usize) * 2)
        + match role {
            Role::Pone => 0,
            Role::Dealer => 1,
        }
}

fn action_index(action: RankPegAction) -> Result<usize, String> {
    match action {
        RankPegAction::Play(rank) if rank < 13 => Ok(rank as usize),
        RankPegAction::Play(rank) => Err(format!("invalid action rank {}", rank)),
        RankPegAction::Go => Ok(GO_ACTION),
    }
}

fn index_action(index: usize) -> RankPegAction {
    if index == GO_ACTION {
        RankPegAction::Go
    } else {
        RankPegAction::Play(index as u8)
    }
}

fn action_mask(actions: &[RankPegAction]) -> Result<u16, String> {
    let mut mask = 0_u16;
    for action in actions {
        mask |= 1 << action_index(*action)?;
    }
    validate_legal_mask(mask)?;
    Ok(mask)
}

fn validate_legal_mask(mask: u16) -> Result<(), String> {
    if mask == 0 || mask >> ACTION_COUNT != 0 {
        Err(format!("invalid legal action mask {:#x}", mask))
    } else {
        Ok(())
    }
}

fn ensure_same_legal_mask(node: &PolicyNode, mask: u16) -> Result<(), String> {
    if node.legal_mask == mask {
        Ok(())
    } else {
        Err(format!(
            "information set changed legal actions from {:#x} to {:#x}",
            node.legal_mask, mask
        ))
    }
}

fn normalized_positive(values: &[f64; ACTION_COUNT], mask: u16) -> [f64; ACTION_COUNT] {
    let mut strategy = [0.0; ACTION_COUNT];
    let mut total = 0.0;
    let mut legal_count = 0_u32;
    for (action, value) in strategy.iter_mut().enumerate() {
        if mask & (1 << action) != 0 {
            legal_count += 1;
            *value = values[action].max(0.0);
            total += *value;
        }
    }
    if total > 0.0 {
        for value in &mut strategy {
            *value /= total;
        }
    } else if legal_count != 0 {
        let uniform = 1.0 / f64::from(legal_count);
        for (action, value) in strategy.iter_mut().enumerate() {
            if mask & (1 << action) != 0 {
                *value = uniform;
            }
        }
    }
    strategy
}

fn sample_strategy(
    strategy: &[f64; ACTION_COUNT],
    legal_mask: u16,
    rng: &mut TrainingRng,
) -> usize {
    let target = rng.unit_f64();
    let mut cumulative = 0.0;
    let mut last_legal = 0;
    for (action, probability) in strategy.iter().enumerate() {
        if legal_mask & (1 << action) == 0 {
            continue;
        }
        last_legal = action;
        cumulative += *probability;
        if target < cumulative {
            return action;
        }
    }
    last_legal
}

#[derive(Clone, Debug)]
struct TrainingRng {
    state: u64,
}

impl TrainingRng {
    fn for_iteration(seed: u64, iteration: u64) -> TrainingRng {
        TrainingRng {
            state: mix64(seed ^ iteration.wrapping_mul(0x9e37_79b9_7f4a_7c15)),
        }
    }

    fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9e37_79b9_7f4a_7c15);
        mix64(self.state)
    }

    fn range(&mut self, upper: u64) -> u64 {
        debug_assert!(upper > 0);
        self.next_u64() % upper
    }

    fn unit_f64(&mut self) -> f64 {
        (self.next_u64() >> 11) as f64 / ((1_u64 << 53) as f64)
    }

    fn shuffle<T>(&mut self, values: &mut [T]) {
        for index in (1..values.len()).rev() {
            let swap = self.range((index + 1) as u64) as usize;
            values.swap(index, swap);
        }
    }
}

fn mix64(mut value: u64) -> u64 {
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    hash
}

struct ByteCursor<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> ByteCursor<'a> {
    fn new(bytes: &'a [u8]) -> ByteCursor<'a> {
        ByteCursor { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Result<&'a [u8], String> {
        let end = self
            .offset
            .checked_add(length)
            .ok_or_else(|| "checkpoint offset overflow".to_string())?;
        let slice = self
            .bytes
            .get(self.offset..end)
            .ok_or_else(|| "checkpoint is truncated".to_string())?;
        self.offset = end;
        Ok(slice)
    }

    fn u16(&mut self) -> Result<u16, String> {
        Ok(u16::from_le_bytes(self.take(2)?.try_into().unwrap()))
    }

    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_le_bytes(self.take(4)?.try_into().unwrap()))
    }

    fn u64(&mut self) -> Result<u64, String> {
        Ok(u64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn f64(&mut self) -> Result<f64, String> {
        Ok(f64::from_le_bytes(self.take(8)?.try_into().unwrap()))
    }

    fn remaining(&self) -> usize {
        self.bytes.len() - self.offset
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use cribbage_shadow_engine::information_set::RankPegEvent;

    fn rank_hand(entries: &[(u8, u8)]) -> [u8; 13] {
        let mut hand = [0_u8; 13];
        for (rank, copies) in entries {
            hand[*rank as usize] = *copies;
        }
        hand
    }

    fn policy_state(hands: [[u8; 13]; 2]) -> RankPegState {
        RankPegState {
            hands,
            own_discards: [rank_hand(&[(0, 1), (1, 1)]), rank_hand(&[(2, 1), (3, 1)])],
            turn_rank: 4,
            scores: [97, 112],
            dealer: PegSeat::One,
            current: PegSeat::Zero,
            plays: vec![7],
            count: 8,
            go_player: None,
            last_player: Some(PegSeat::One),
            history: vec![
                RankPegEvent::Play {
                    seat: PegSeat::Zero,
                    rank: 5,
                },
                RankPegEvent::Reset,
                RankPegEvent::Play {
                    seat: PegSeat::One,
                    rank: 7,
                },
            ],
            winner: None,
            complete: false,
        }
    }

    #[test]
    fn policy_abstraction_is_hidden_hand_invariant_and_action_safe() {
        let first = policy_state([rank_hand(&[(4, 1), (9, 1)]), rank_hand(&[(6, 2)])]);
        let mut second = policy_state([rank_hand(&[(4, 1), (9, 1)]), rank_hand(&[(8, 2)])]);
        second.turn_rank = 12;
        second.own_discards[0] = rank_hand(&[(10, 2)]);

        assert_eq!(
            PolicyInformationSetKey::from_state(&first, PegSeat::Zero).unwrap(),
            PolicyInformationSetKey::from_state(&second, PegSeat::Zero).unwrap()
        );
        assert_eq!(first.legal_actions(), second.legal_actions());
    }

    #[test]
    fn policy_key_packs_deterministically() {
        let state = policy_state([rank_hand(&[(4, 1), (9, 1)]), rank_hand(&[(6, 2)])]);
        let key = PolicyInformationSetKey::from_state(&state, PegSeat::Zero).unwrap();
        let bytes = key.to_packed_bytes();
        assert_eq!(
            PolicyInformationSetKey::from_packed_bytes(&bytes).unwrap(),
            key
        );
        let mut corrupt = bytes;
        corrupt[26] = 15;
        assert!(PolicyInformationSetKey::from_packed_bytes(&corrupt).is_err());
    }

    #[test]
    fn board_pressure_classes_keep_out_ranges_distinct() {
        let mut state = policy_state([rank_hand(&[(4, 1)]), rank_hand(&[(6, 1)])]);
        for (scores, expected) in [
            ([89, 89], 0),
            ([110, 80], 13),
            ([80, 110], 14),
            ([118, 80], 3),
            ([119, 118], 6),
            ([80, 120], 9),
        ] {
            state.scores = scores;
            assert_eq!(
                PolicyInformationSetKey::from_state(&state, PegSeat::Zero)
                    .unwrap()
                    .board_pressure_class,
                expected
            );
        }
    }

    #[test]
    fn deterministic_single_worker_checksum() {
        let first = SharedTrainer::new();
        first.train_range(17, 0, 128, 1).unwrap();
        let first = first.checkpoint(17, 128).unwrap();
        let second = SharedTrainer::new();
        second.train_range(17, 0, 128, 1).unwrap();
        let second = second.checkpoint(17, 128).unwrap();
        assert_eq!(first.checksum(), second.checksum());
        assert_eq!(first.nodes, second.nodes);
    }

    #[test]
    fn checkpoint_resume_matches_continuous_training() {
        let continuous = SharedTrainer::new();
        continuous.train_range(91, 0, 160, 1).unwrap();
        let continuous = continuous.checkpoint(91, 160).unwrap();

        let first_half = SharedTrainer::new();
        first_half.train_range(91, 0, 80, 1).unwrap();
        let saved = first_half.checkpoint(91, 80).unwrap();
        let resumed = SharedTrainer::from_checkpoint(&saved).unwrap();
        resumed.train_range(91, 80, 160, 1).unwrap();
        let resumed = resumed.checkpoint(91, 160).unwrap();

        assert_eq!(continuous.checksum(), resumed.checksum());
        assert_eq!(continuous.nodes, resumed.nodes);
    }

    #[test]
    fn checkpoint_binary_round_trips_and_rejects_truncation() {
        let trainer = SharedTrainer::new();
        trainer.train_range(5, 0, 16, 1).unwrap();
        let checkpoint = trainer.checkpoint(5, 16).unwrap();
        let bytes = checkpoint.to_bytes();
        let round_trip = Checkpoint::from_bytes(&bytes).unwrap();
        assert_eq!(round_trip.nodes, checkpoint.nodes);
        assert_eq!(
            round_trip.pending_fingerprints,
            checkpoint.pending_fingerprints
        );
        assert!(Checkpoint::from_bytes(&bytes[..bytes.len() - 1]).is_err());
    }

    #[test]
    fn policy_artifact_is_deterministic_and_matches_average_strategy() {
        let state = policy_state([rank_hand(&[(4, 1), (9, 1)]), rank_hand(&[(6, 2)])]);
        let key = PolicyInformationSetKey::from_state(&state, PegSeat::Zero).unwrap();
        let mut node = PolicyNode::new(key.expected_legal_mask());
        node.strategy_sum[4] = 1.0;
        node.strategy_sum[9] = 3.0;
        node.visits = 1;
        node.strategy_visits = 2;

        let mut filtered_state = state.clone();
        filtered_state.hands[0] = rank_hand(&[(2, 1)]);
        let filtered_key =
            PolicyInformationSetKey::from_state(&filtered_state, PegSeat::Zero).unwrap();
        let mut filtered_node = PolicyNode::new(filtered_key.expected_legal_mask());
        filtered_node.visits = 1;

        let checkpoint = Checkpoint {
            seed: 0x1600,
            iterations: 77,
            nodes: vec![(filtered_key, filtered_node), (key, node.clone())],
            pending_fingerprints: vec![3, 1],
        };
        let artifact = build_policy_artifact(&checkpoint, 2, "unit-test".to_string()).unwrap();
        assert_eq!(artifact.entries.len(), 1);
        assert_eq!(artifact.metadata.source_nodes, 2);
        assert_eq!(artifact.metadata.source_singletons, 2);
        assert_eq!(artifact.metadata.checkpoint_checksum, checkpoint.checksum());
        let entry = artifact.lookup(&key).unwrap();
        assert_eq!(entry.confidence, 3);
        for action in [4, 9] {
            assert!(
                (entry.probabilities()[action] - node.average_strategy()[action]).abs()
                    <= 1.0 / f64::from(POLICY_WEIGHT_TOTAL)
            );
        }

        let mut reordered = checkpoint.clone();
        reordered.nodes.reverse();
        reordered.pending_fingerprints.reverse();
        let second = build_policy_artifact(&reordered, 2, "unit-test".to_string()).unwrap();
        assert_eq!(artifact.to_bytes().unwrap(), second.to_bytes().unwrap());
        assert_eq!(
            PolicyArtifact::from_bytes(&artifact.to_bytes().unwrap()).unwrap(),
            artifact
        );
    }

    #[test]
    fn policy_artifact_uses_current_strategy_without_average_samples() {
        let state = policy_state([rank_hand(&[(4, 1), (9, 1)]), rank_hand(&[(6, 2)])]);
        let key = PolicyInformationSetKey::from_state(&state, PegSeat::Zero).unwrap();
        let mut node = PolicyNode::new(key.expected_legal_mask());
        node.regrets[4] = 4.0;
        node.regrets[9] = 1.0;
        node.visits = 2;
        let expected = node.current_strategy();
        let checkpoint = Checkpoint {
            seed: 1,
            iterations: 2,
            nodes: vec![(key, node)],
            pending_fingerprints: Vec::new(),
        };
        let artifact = build_policy_artifact(&checkpoint, 1, "fallback-test".to_string()).unwrap();
        let probabilities = artifact.entries[0].probabilities();
        for action in [4, 9] {
            assert!(
                (probabilities[action] - expected[action]).abs()
                    <= 1.0 / f64::from(POLICY_WEIGHT_TOTAL)
            );
        }
    }

    #[test]
    fn checkpoint_statistics_report_sampled_regret_proxies() {
        let state = policy_state([rank_hand(&[(4, 1), (9, 1)]), rank_hand(&[(6, 2)])]);
        let key = PolicyInformationSetKey::from_state(&state, PegSeat::Zero).unwrap();
        let mut node = PolicyNode::new(key.expected_legal_mask());
        node.regrets[4] = 4.0;
        node.regrets[9] = -1.0;
        node.visits = 2;
        node.strategy_visits = 3;
        let statistics = Checkpoint {
            seed: 1,
            iterations: 2,
            nodes: vec![(key, node)],
            pending_fingerprints: Vec::new(),
        }
        .statistics();

        assert_eq!(statistics.regret_updates, 2);
        assert_eq!(statistics.average_strategy_samples, 3);
        assert_eq!(statistics.positive_regret_per_update, 2.0);
        assert_eq!(statistics.max_positive_regret_per_update, 2.0);
        assert_eq!(statistics.mean_normalized_policy_entropy, 0.0);
    }

    #[test]
    fn strategies_normalize_without_weighting_illegal_actions() {
        let mut node = PolicyNode::new((1 << 2) | (1 << 7));
        node.regrets[2] = 3.0;
        node.regrets[7] = 1.0;
        node.regrets[5] = 1000.0;
        let strategy = node.current_strategy();
        assert!((strategy[2] - 0.75).abs() < 1e-12);
        assert!((strategy[7] - 0.25).abs() < 1e-12);
        assert_eq!(strategy[5], 0.0);
        assert!((strategy.iter().sum::<f64>() - 1.0).abs() < 1e-12);
    }

    #[test]
    fn sampled_deal_has_unique_cards_and_legal_private_views() {
        let mut rng = TrainingRng::for_iteration(101, 9);
        let deal = sample_training_deal(&mut rng);
        let mut ids = deal
            .retained
            .iter()
            .flatten()
            .chain(deal.discards.iter().flatten())
            .map(|card| card.id)
            .collect::<Vec<_>>();
        ids.push(deal.turn_card.id);
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), 13);
        let state = deal.initial_state();
        assert!(state.information_set(PegSeat::Zero).is_ok());
        assert!(state.information_set(PegSeat::One).is_ok());
    }

    #[test]
    fn realistic_training_corpus_parses_compact_game_hands() {
        let line = "0\t0\t0\t38\t041A161E0702\t1C1D0B321020\t1A161E02\t1C1D3210\t04070B20";
        let deal = parse_training_corpus_line(line, 1).unwrap();
        assert_eq!(deal.dealer, PegSeat::Zero);
        assert_eq!(deal.starting_scores, [0, 0]);
        assert_eq!(deal.retained[0].len(), 4);
        assert_eq!(deal.retained[1].len(), 4);
        assert_eq!(deal.discards[0].len(), 2);
        assert_eq!(deal.discards[1].len(), 2);
        assert_eq!(deal.crib.len(), 4);
    }

    #[test]
    fn corpus_training_is_deterministic_for_one_worker() {
        let line = "0\t0\t0\t38\t041A161E0702\t1C1D0B321020\t1A161E02\t1C1D3210\t04070B20";
        let corpus = TrainingCorpus {
            deals: vec![parse_training_corpus_line(line, 1).unwrap()],
            checksum: fnv1a64(line.as_bytes()),
        };
        let first = SharedTrainer::new();
        let second = SharedTrainer::new();
        first
            .train_range_with_corpus(0x16c0ffee, 0, 100, 1, Some(&corpus))
            .unwrap();
        second
            .train_range_with_corpus(0x16c0ffee, 0, 100, 1, Some(&corpus))
            .unwrap();
        assert_eq!(
            first.checkpoint(0x16c0ffee, 100).unwrap().checksum(),
            second.checkpoint(0x16c0ffee, 100).unwrap().checksum()
        );
    }
}
