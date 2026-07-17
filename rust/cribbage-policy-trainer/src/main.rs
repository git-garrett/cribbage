use cribbage_policy_trainer::{Checkpoint, SharedTrainer};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process;
use std::time::{Duration, Instant};

const REFERENCE_WALL_SECONDS: f64 = 15.05 * 60.0 * 60.0;

#[derive(Clone, Debug)]
struct Config {
    iterations: u64,
    seed: u64,
    workers: usize,
    checkpoint: PathBuf,
    status: PathBuf,
    checkpoint_every: u64,
    status_every: u64,
    wall_budget: Duration,
    max_reference_equivalents: f64,
    max_information_sets: usize,
    resume: bool,
    probe_without_checkpoint: bool,
}

#[derive(Clone, Debug)]
struct Progress {
    state: &'static str,
    completed: u64,
    session_start: u64,
    trained_information_sets: usize,
    pending_information_sets: usize,
    elapsed: Duration,
    checksum: Option<String>,
}

fn main() {
    let config = match parse_args(env::args().skip(1).collect()) {
        Ok(config) => config,
        Err(error) => {
            eprintln!("{}", error);
            print_usage();
            process::exit(2);
        }
    };
    if let Err(error) = run(&config) {
        eprintln!("{}", error);
        process::exit(1);
    }
}

fn run(config: &Config) -> Result<(), String> {
    let (trainer, starting_iteration) = if config.resume {
        let checkpoint = Checkpoint::load(&config.checkpoint)?;
        if checkpoint.seed != config.seed {
            return Err(format!(
                "checkpoint seed {} does not match requested seed {}",
                checkpoint.seed, config.seed
            ));
        }
        if checkpoint.iterations > config.iterations {
            return Err(format!(
                "checkpoint already has {} iterations, beyond target {}",
                checkpoint.iterations, config.iterations
            ));
        }
        (
            SharedTrainer::from_checkpoint(&checkpoint)?,
            checkpoint.iterations,
        )
    } else {
        if config.checkpoint.exists() {
            return Err(format!(
                "checkpoint {} already exists; use --resume or choose a new path",
                config.checkpoint.display()
            ));
        }
        (SharedTrainer::new(), 0)
    };

    let started = Instant::now();
    let mut completed = starting_iteration;
    let mut last_checkpoint_iteration = starting_iteration;
    let mut last_checksum = if config.resume {
        Some(
            trainer
                .checkpoint(config.seed, starting_iteration)?
                .checksum_hex(),
        )
    } else {
        None
    };
    write_status(
        config,
        &Progress {
            state: if completed == config.iterations {
                "complete"
            } else {
                "running"
            },
            completed,
            session_start: starting_iteration,
            trained_information_sets: trainer.node_count(),
            pending_information_sets: trainer.pending_count(),
            elapsed: started.elapsed(),
            checksum: last_checksum.clone(),
        },
    )?;

    let batch_size = config.status_every.min(config.checkpoint_every).max(1);
    let mut final_state = "complete";
    while completed < config.iterations {
        let batch_end = completed.saturating_add(batch_size).min(config.iterations);
        trainer.train_range(config.seed, completed, batch_end, config.workers)?;
        completed = batch_end;
        let checkpoint_due = completed == config.iterations
            || completed - last_checkpoint_iteration >= config.checkpoint_every;
        if checkpoint_due && !config.probe_without_checkpoint {
            let checkpoint = trainer.checkpoint(config.seed, completed)?;
            last_checksum = Some(checkpoint.checksum_hex());
            checkpoint.save(&config.checkpoint)?;
            last_checkpoint_iteration = completed;
        }

        let mut elapsed = started.elapsed();
        let session_iterations = completed - starting_iteration;
        let rate = rate(session_iterations, elapsed);
        let projected_seconds = if rate > 0.0 {
            config.iterations as f64 / rate
        } else {
            f64::INFINITY
        };
        let projected_equivalents = projected_seconds / REFERENCE_WALL_SECONDS;

        if elapsed >= config.wall_budget {
            final_state = "wall_budget_exhausted";
        } else if trainer.information_set_count() >= config.max_information_sets {
            final_state = "information_set_limit_exceeded";
        } else if session_iterations >= 1_000
            && projected_equivalents >= config.max_reference_equivalents
        {
            final_state = "projection_limit_exceeded";
        }
        if final_state != "complete" || completed == config.iterations {
            if last_checkpoint_iteration != completed && !config.probe_without_checkpoint {
                let checkpoint = trainer.checkpoint(config.seed, completed)?;
                last_checksum = Some(checkpoint.checksum_hex());
                checkpoint.save(&config.checkpoint)?;
                elapsed = started.elapsed();
            }
            write_status(
                config,
                &Progress {
                    state: final_state,
                    completed,
                    session_start: starting_iteration,
                    trained_information_sets: trainer.node_count(),
                    pending_information_sets: trainer.pending_count(),
                    elapsed,
                    checksum: last_checksum.clone(),
                },
            )?;
            break;
        }
        write_status(
            config,
            &Progress {
                state: "running",
                completed,
                session_start: starting_iteration,
                trained_information_sets: trainer.node_count(),
                pending_information_sets: trainer.pending_count(),
                elapsed,
                checksum: last_checksum.clone(),
            },
        )?;
    }

    println!(
        "state={} iterations={}/{} trainedInformationSets={} pendingInformationSets={} elapsedSeconds={:.3} checkpoint={} status={}",
        final_state,
        completed,
        config.iterations,
        trainer.node_count(),
        trainer.pending_count(),
        started.elapsed().as_secs_f64(),
        config.checkpoint.display(),
        config.status.display()
    );
    Ok(())
}

fn write_status(config: &Config, progress: &Progress) -> Result<(), String> {
    let session_iterations = progress.completed - progress.session_start;
    let iterations_per_second = rate(session_iterations, progress.elapsed);
    let remaining = config.iterations.saturating_sub(progress.completed);
    let eta_seconds = if iterations_per_second > 0.0 {
        remaining as f64 / iterations_per_second
    } else {
        0.0
    };
    let projected_total_seconds = if iterations_per_second > 0.0 {
        config.iterations as f64 / iterations_per_second
    } else {
        0.0
    };
    let checksum = progress
        .checksum
        .as_ref()
        .map(|value| format!("\"{}\"", json_escape(value)))
        .unwrap_or_else(|| "null".to_string());
    let contents = format!(
        concat!(
            "{{\n",
            "  \"state\": \"{}\",\n",
            "  \"seed\": {},\n",
            "  \"workers\": {},\n",
            "  \"targetIterations\": {},\n",
            "  \"completedIterations\": {},\n",
            "  \"sessionIterations\": {},\n",
            "  \"informationSets\": {},\n",
            "  \"trainedInformationSets\": {},\n",
            "  \"pendingInformationSets\": {},\n",
            "  \"elapsedSeconds\": {:.6},\n",
            "  \"iterationsPerSecond\": {:.6},\n",
            "  \"etaSeconds\": {:.3},\n",
            "  \"projectedTotalSeconds\": {:.3},\n",
            "  \"projectedReferenceEquivalents\": {:.6},\n",
            "  \"wallBudgetSeconds\": {:.3},\n",
            "  \"maxReferenceEquivalents\": {:.3},\n",
            "  \"maxInformationSets\": {},\n",
            "  \"checkpoint\": \"{}\",\n",
            "  \"checkpointChecksum\": {}\n",
            "}}\n"
        ),
        progress.state,
        config.seed,
        config.workers,
        config.iterations,
        progress.completed,
        session_iterations,
        progress.trained_information_sets + progress.pending_information_sets,
        progress.trained_information_sets,
        progress.pending_information_sets,
        progress.elapsed.as_secs_f64(),
        iterations_per_second,
        eta_seconds,
        projected_total_seconds,
        projected_total_seconds / REFERENCE_WALL_SECONDS,
        config.wall_budget.as_secs_f64(),
        config.max_reference_equivalents,
        config.max_information_sets,
        json_escape(&config.checkpoint.display().to_string()),
        checksum,
    );
    atomic_write(&config.status, contents.as_bytes())
}

fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), String> {
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    fs::create_dir_all(parent)
        .map_err(|error| format!("create {} failed: {}", parent.display(), error))?;
    let temporary = path.with_extension("tmp");
    let mut file = fs::File::create(&temporary)
        .map_err(|error| format!("create {} failed: {}", temporary.display(), error))?;
    file.write_all(contents)
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

fn rate(iterations: u64, elapsed: Duration) -> f64 {
    if elapsed.is_zero() {
        0.0
    } else {
        iterations as f64 / elapsed.as_secs_f64()
    }
}

fn parse_args(args: Vec<String>) -> Result<Config, String> {
    let mut iterations = None;
    let mut seed = 0x16c0_ffee_u64;
    let mut workers = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(1);
    let mut checkpoint = None;
    let mut status = None;
    let mut checkpoint_every = 10_000_u64;
    let mut status_every = 1_000_u64;
    let mut wall_budget_seconds = 8.0 * 60.0 * 60.0;
    let mut max_reference_equivalents = 10.0;
    let mut max_information_sets = 12_000_000_usize;
    let mut resume = false;
    let mut probe_without_checkpoint = false;

    let mut index = 0;
    while index < args.len() {
        let key = &args[index];
        if key == "--resume" {
            resume = true;
            index += 1;
            continue;
        }
        if key == "--probe-without-checkpoint" {
            probe_without_checkpoint = true;
            index += 1;
            continue;
        }
        if key == "--help" || key == "-h" {
            return Err("usage requested".to_string());
        }
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("missing value for {}", key))?;
        match key.as_str() {
            "--iterations" => iterations = Some(parse_u64(key, value)?),
            "--seed" => seed = parse_seed(value)?,
            "--workers" => workers = parse_usize(key, value)?,
            "--checkpoint" => checkpoint = Some(PathBuf::from(value)),
            "--status" => status = Some(PathBuf::from(value)),
            "--checkpoint-every" => checkpoint_every = parse_u64(key, value)?,
            "--status-every" => status_every = parse_u64(key, value)?,
            "--wall-budget-seconds" => wall_budget_seconds = parse_f64(key, value)?,
            "--max-reference-equivalents" => max_reference_equivalents = parse_f64(key, value)?,
            "--max-information-sets" => max_information_sets = parse_usize(key, value)?,
            other => return Err(format!("unknown argument: {}", other)),
        }
        index += 2;
    }

    let iterations = iterations.ok_or_else(|| "--iterations is required".to_string())?;
    let checkpoint = checkpoint.ok_or_else(|| "--checkpoint is required".to_string())?;
    let status = status.unwrap_or_else(|| checkpoint.with_extension("status.json"));
    if resume && probe_without_checkpoint {
        return Err("--resume cannot be combined with --probe-without-checkpoint".to_string());
    }
    if iterations == 0
        || workers == 0
        || checkpoint_every == 0
        || status_every == 0
        || wall_budget_seconds <= 0.0
        || max_reference_equivalents <= 0.0
        || max_information_sets == 0
    {
        return Err("numeric arguments must be greater than zero".to_string());
    }
    Ok(Config {
        iterations,
        seed,
        workers,
        checkpoint,
        status,
        checkpoint_every,
        status_every,
        wall_budget: Duration::from_secs_f64(wall_budget_seconds),
        max_reference_equivalents,
        max_information_sets,
        resume,
        probe_without_checkpoint,
    })
}

fn parse_u64(label: &str, value: &str) -> Result<u64, String> {
    value
        .parse::<u64>()
        .map_err(|error| format!("invalid {} value {}: {}", label, value, error))
}

fn parse_usize(label: &str, value: &str) -> Result<usize, String> {
    value
        .parse::<usize>()
        .map_err(|error| format!("invalid {} value {}: {}", label, value, error))
}

fn parse_f64(label: &str, value: &str) -> Result<f64, String> {
    let parsed = value
        .parse::<f64>()
        .map_err(|error| format!("invalid {} value {}: {}", label, value, error))?;
    if parsed.is_finite() {
        Ok(parsed)
    } else {
        Err(format!("{} must be finite", label))
    }
}

fn parse_seed(value: &str) -> Result<u64, String> {
    if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        u64::from_str_radix(hex, 16).map_err(|error| format!("invalid seed {}: {}", value, error))
    } else {
        parse_u64("--seed", value)
    }
}

fn json_escape(value: &str) -> String {
    value
        .replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('\n', "\\n")
        .replace('\r', "\\r")
}

fn print_usage() {
    eprintln!(concat!(
        "Usage: cribbage-policy-trainer ",
        "--iterations N --checkpoint PATH [options]\n",
        "  --seed N|0xHEX\n",
        "  --workers N\n",
        "  --status PATH\n",
        "  --checkpoint-every N\n",
        "  --status-every N\n",
        "  --wall-budget-seconds N\n",
        "  --max-reference-equivalents N\n",
        "  --max-information-sets N\n",
        "  --probe-without-checkpoint\n",
        "  --resume"
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_resume_and_hex_seed() {
        let config = parse_args(vec![
            "--iterations".into(),
            "100".into(),
            "--checkpoint".into(),
            "run.cfr".into(),
            "--seed".into(),
            "0x10".into(),
            "--resume".into(),
        ])
        .unwrap();
        assert_eq!(config.seed, 16);
        assert!(config.resume);
        assert_eq!(config.status, PathBuf::from("run.status.json"));
    }

    #[test]
    fn rejects_zero_limits() {
        assert!(parse_args(vec![
            "--iterations".into(),
            "0".into(),
            "--checkpoint".into(),
            "run.cfr".into(),
        ])
        .is_err());
    }
}
