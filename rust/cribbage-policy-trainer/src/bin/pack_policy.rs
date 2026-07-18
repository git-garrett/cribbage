use cribbage_policy_trainer::{build_policy_artifact, Checkpoint};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::process;

#[derive(Clone, Debug, Eq, PartialEq)]
struct Config {
    checkpoint: PathBuf,
    output: PathBuf,
    minimum_visits: u64,
    provenance: String,
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
    let checkpoint = Checkpoint::load(&config.checkpoint)?;
    let artifact = build_policy_artifact(
        &checkpoint,
        config.minimum_visits,
        config.provenance.clone(),
    )?;
    artifact.save(&config.output)?;
    let bytes = fs::metadata(&config.output)
        .map_err(|error| format!("stat {} failed: {}", config.output.display(), error))?
        .len();
    println!(
        concat!(
            "entries={} sourceNodes={} sourceSingletons={} minimumVisits={} ",
            "checkpointChecksum={:016x} artifactChecksum={:016x} bytes={} output={}"
        ),
        artifact.metadata.included_entries,
        artifact.metadata.source_nodes,
        artifact.metadata.source_singletons,
        artifact.metadata.minimum_visits,
        artifact.metadata.checkpoint_checksum,
        artifact.checksum()?,
        bytes,
        config.output.display()
    );
    Ok(())
}

fn parse_args(args: Vec<String>) -> Result<Config, String> {
    let mut checkpoint = None;
    let mut output = None;
    let mut minimum_visits = 2_u64;
    let mut provenance = "model16 external-sampling MCCFR average policy".to_string();
    let mut index = 0;
    while index < args.len() {
        let key = &args[index];
        if key == "--help" || key == "-h" {
            return Err("usage requested".to_string());
        }
        let value = args
            .get(index + 1)
            .ok_or_else(|| format!("missing value for {}", key))?;
        match key.as_str() {
            "--checkpoint" => checkpoint = Some(PathBuf::from(value)),
            "--output" => output = Some(PathBuf::from(value)),
            "--minimum-visits" => {
                minimum_visits = value.parse::<u64>().map_err(|error| {
                    format!("invalid --minimum-visits value {}: {}", value, error)
                })?
            }
            "--provenance" => provenance = value.clone(),
            other => return Err(format!("unknown argument: {}", other)),
        }
        index += 2;
    }
    if minimum_visits == 0 {
        return Err("--minimum-visits must be greater than zero".to_string());
    }
    if provenance.trim().is_empty() {
        return Err("--provenance must not be empty".to_string());
    }
    Ok(Config {
        checkpoint: checkpoint.ok_or_else(|| "--checkpoint is required".to_string())?,
        output: output.ok_or_else(|| "--output is required".to_string())?,
        minimum_visits,
        provenance,
    })
}

fn print_usage() {
    eprintln!(concat!(
        "Usage: pack_policy --checkpoint PATH --output PATH [options]\n",
        "  --minimum-visits N\n",
        "  --provenance TEXT"
    ));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_required_paths_and_defaults() {
        let config = parse_args(vec![
            "--checkpoint".into(),
            "run.cfr".into(),
            "--output".into(),
            "policy.bin".into(),
        ])
        .unwrap();
        assert_eq!(config.checkpoint, PathBuf::from("run.cfr"));
        assert_eq!(config.output, PathBuf::from("policy.bin"));
        assert_eq!(config.minimum_visits, 2);
    }

    #[test]
    fn rejects_missing_paths_and_zero_visits() {
        assert!(parse_args(vec![
            "--checkpoint".into(),
            "run.cfr".into(),
            "--minimum-visits".into(),
            "0".into(),
        ])
        .is_err());
    }
}
