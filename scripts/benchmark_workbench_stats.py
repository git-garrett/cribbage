"""Paired inference, with fixed bets chosen independently of benchmark data."""

import math


Z95 = 1.959963984540054
# Each signed product is a nonnegative martingale at the true conditional mean.
# Equal mixtures retain that property. Ville + alpha/2 per tail gives simultaneous
# 95% coverage at every pair count, without a normal approximation. See docs.
BETS = (0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.0)
METRICS = ('final_score', 'peg_pone', 'peg_dealer', 'hand_pone', 'hand_dealer', 'crib',
           'wp_discard_pone', 'wp_discard_dealer', 'wp_pegging_pone', 'wp_pegging_dealer',
           'pone_open')


def log_capital(counts, mean, direction):
    values = []
    for bet in BETS:
        value = 0.0
        for count, outcome in zip(counts, (0.0, 0.5, 1.0)):
            if not count:
                continue
            factor = direction * bet * (outcome - mean)
            if factor <= -1:
                value = -math.inf
                break
            value += count * math.log1p(factor)
        values.append(value)
    largest = max(values)
    if largest == -math.inf:
        return largest
    return largest + math.log(sum(math.exp(x - largest) for x in values) / len(values))


def confidence_sequence(counts):
    """Conservative endpoints for the two one-sided mixture tests (alpha=.025)."""
    threshold = math.log(40)
    bounds = []
    for direction in (1, -1):
        endpoint = 0 if direction == 1 else 1
        if log_capital(counts, endpoint, direction) < threshold:
            bounds.append(float(endpoint))
            continue
        low, high = 0.0, 1.0
        for _ in range(42):
            mid = (low + high) / 2
            rejected = log_capital(counts, mid, direction) >= threshold
            if rejected == (direction == 1):
                low = mid
            else:
                high = mid
        # Round outward: do not accidentally exclude an accepted mean.
        bounds.append(low if direction == 1 else high)
    return bounds


def normal_interval(total, squares, count, bounded=False):
    if count < 2:
        return None
    mean = total / count
    error = math.sqrt(max(0, squares - total * total / count) / (count - 1) / count)
    lower, upper = mean - Z95 * error, mean + Z95 * error
    return [max(0, lower), min(1, upper)] if bounded else [lower, upper]


def paired_history(pairs):
    """Sample at most ~250 graph points; inference always includes every pair."""
    counts = [0, 0, 0]
    wins = squares = margin = margin_squares = 0.0
    history = []
    stride = max(1, math.ceil(len(pairs) / 250))
    for n, (left, right) in enumerate(pairs, 1):
        pair_wins = int(left['winner'] == 0) + int(right['winner'] == 1)
        fraction = pair_wins / 2
        delta = (left['final_left_score'] - left['final_right_score'] +
                 right['final_right_score'] - right['final_left_score']) / 2
        counts[pair_wins] += 1
        wins += fraction
        squares += fraction * fraction
        margin += delta
        margin_squares += delta * delta
        if n == 1 or n % stride == 0 or n == len(pairs):
            history.append({
                'pairs': n, 'winRate': wins / n,
                'fixed95': normal_interval(wins, squares, n, True),
                'anytime95': confidence_sequence(counts),
                'scoreDelta': margin / n,
                'score95': normal_interval(margin, margin_squares, n),
                'candidateSweeps': counts[2], 'splits': counts[1],
                'opponentSweeps': counts[0],
            })
    return history


class PairedRatio:
    """Clustered delta-method intervals for two observation-weighted means.

    One independent cluster is a reciprocal deal pair. Keep all within-game
    and between-model covariance, rather than treating hands/calls as iid.
    V = m/(m-1) sum_i (g dot v_i)^2, with g the gradient of A/Na - B/Nb.
    Since g dot sum(v_i) = 0, these are already centered residuals.
    """

    def __init__(self):
        self.count = 0
        self.model_counts = [0, 0]
        self.total = [0.0] * 4
        self.products = [[0.0] * 4 for _ in range(4)]
        self.context = [0.0] * 4

    def add(self, a, b):
        if not (a[1] or b[1]):
            return
        self.count += 1
        self.model_counts[0] += bool(a[1])
        self.model_counts[1] += bool(b[1])
        values = [a[0], a[1], b[0], b[1]]
        for i in range(4):
            self.total[i] += values[i]
            for j in range(4):
                self.products[i][j] += values[i] * values[j]
        # Optional WP context: summed predictions and actual outcomes.
        for offset, sample in ((0, a), (2, b)):
            if len(sample) == 4:
                self.context[offset] += sample[2]
                self.context[offset + 1] += sample[3]

    def snapshot(self, pairs):
        a, na, b, nb = self.total
        if not na and not nb:
            return None
        mean_a, mean_b = a / na if na else None, b / nb if nb else None

        def bounds(mean, gradient):
            variance = sum(gradient[i] * gradient[j] * self.products[i][j]
                           for i in range(4) for j in range(4))
            error = Z95 * math.sqrt(max(0, variance) * self.count / (self.count - 1))
            return [mean - error, mean + error]

        ga = [1 / na, -mean_a / na, 0, 0] if na else None
        gb = [0, 0, 1 / nb, -mean_b / nb] if nb else None
        delta = mean_a - mean_b if na and nb else None
        return {'pairs': pairs, 'clusters': self.count,
                'candidate': mean_a, 'opponent': mean_b, 'delta': delta,
                'candidateClusters': self.model_counts[0], 'opponentClusters': self.model_counts[1],
                'candidate95': bounds(mean_a, ga) if self.model_counts[0] >= 2 else None,
                'opponent95': bounds(mean_b, gb) if self.model_counts[1] >= 2 else None,
                'fixed95': bounds(delta, [x - y for x, y in zip(ga, gb)]) if min(self.model_counts) >= 2 else None,
                'candidateN': int(na), 'opponentN': int(nb),
                'candidatePredicted': self.context[0] / na if na else None, 'candidateActual': self.context[1] / na if na else None,
                'opponentPredicted': self.context[2] / nb if nb else None, 'opponentActual': self.context[3] / nb if nb else None}


def metric_histories(pairs):
    """Use the same ordered prefix and display points as the win-rate graph."""
    histories = {key: [] for key in METRICS}
    accumulators = {key: PairedRatio() for key in METRICS}
    stride = max(1, math.ceil(len(pairs) / 250))
    for n, (left, right) in enumerate(pairs, 1):
        for key, accumulator in accumulators.items():
            # Reverse seats in the reciprocal orientation, then pool samples.
            values = [[0.0] * 4, [0.0] * 4]
            for game, reverse in ((left, False), (right, True)):
                samples = ([[game['final_left_score'], 1], [game['final_right_score'], 1]] if key == 'final_score'
                           else game.get('metrics', {}).get(key, [[0, 0], [0, 0]]))
                for side, sample in enumerate(samples):
                    target = values[1 - side if reverse else side]
                    for i, value in enumerate(sample):
                        target[i] += value
            accumulator.add(*values)
            if n == 1 or n % stride == 0 or n == len(pairs):
                snapshot = accumulator.snapshot(n)
                if snapshot:
                    for field in ('candidate95', 'opponent95'):
                        if snapshot[field]:
                            snapshot[field][0] = max(-1 if key.startswith('wp_') else 0, snapshot[field][0])
                            if key.startswith('wp_'):
                                snapshot[field][1] = min(1, snapshot[field][1])
                    if key.startswith('wp_') and snapshot['fixed95']:
                        snapshot['fixed95'] = [max(-2, snapshot['fixed95'][0]), min(2, snapshot['fixed95'][1])]
                    histories[key].append(snapshot)
    return histories
