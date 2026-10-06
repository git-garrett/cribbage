#!/usr/bin/env python3
"""Apply a verified history report after an optimistic-concurrency check and backup."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import sqlite3


def apply_report(database, report, user_id, username, backup, apply=False):
    if report.get('schemaVersion') != 1 or report.get('status') != 'complete':
        raise ValueError('report is not verified')
    c = sqlite3.connect(f'file:{database}?mode={"rw" if apply else "ro"}', uri=True, timeout=30)
    actual = c.execute('SELECT username FROM auth_users WHERE id=?', (user_id,)).fetchone()
    if not actual or actual[0].casefold() != username.casefold():
        raise ValueError('target account identity does not match')
    # The profile changes whenever new eligible evidence is applied. Refuse to
    # overwrite that progress with the older snapshot used by this review.
    c.execute('BEGIN IMMEDIATE' if apply else 'BEGIN')
    expected = report['expectedProfile']
    profile_row = c.execute('SELECT profile_json,updated_at FROM dynamic_player_profiles WHERE user_id=? AND evaluator_version=?',
                            (user_id, expected['evaluator_version'])).fetchone()
    if not profile_row or profile_row != (expected['profile_json'], expected['updated_at']):
        raise ValueError('player profile changed since the source copy; reconcile new games first')
    # Check all recent uploads, including games with no eligible handicap cycle.
    ids = {g['gameId'] for g in report['reviewedGames']}
    current_ids = {g[0] for g in c.execute("SELECT game_id FROM cribbage_completed_game_uploads WHERE lower(json_extract(payload_json,'$.tag'))=lower(?)", (username,))}
    if not current_ids <= ids:
        raise ValueError('new completed games must be copied and reviewed before import')
    profile = json.loads(profile_row[0])
    allowed = {'handicap_cycles', 'ewma_cycle_handicap', 'length_games', 'ewma_cycles_per_game'}
    if set(report['profilePatch']) != allowed:
        raise ValueError('unexpected profile fields')
    profile.update(report['profilePatch'])
    profile.pop('ewma_game_handicap', None)
    profile.pop('complete_games', None)
    result = {'games': len(ids), 'cycles': profile['handicap_cycles'],
              'wpPerGame': report['summary']['historical']['wpPerGame'], 'applied': apply}
    if not apply:
        c.rollback()
        return result
    if backup.exists():
        raise ValueError('backup destination already exists')
    backup.parent.mkdir(parents=True, exist_ok=True)
    # A separate reader can copy the last committed snapshot while this writer
    # holds the reservation. No writer can race between the check and commit.
    reader = sqlite3.connect(f'file:{database}?mode=ro', uri=True)
    destination = sqlite3.connect(backup)
    reader.backup(destination)
    destination.close()
    reader.close()
    at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    compact = lambda x: json.dumps(x, separators=(',', ':'), sort_keys=True)
    c.execute('INSERT INTO player_history_reassessments VALUES (?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET summary_json=excluded.summary_json,source_sha256=excluded.source_sha256,applied_at=excluded.applied_at',
              (user_id, compact(report['summary']), report['sourceSha256'], at))
    for game in report['reviewedGames']:
        # Original upload and server session rows remain unchanged.
        c.execute('INSERT INTO player_reviewed_games VALUES (?,?,?) ON CONFLICT(game_id) DO UPDATE SET payload_json=excluded.payload_json WHERE player_reviewed_games.user_id=excluded.user_id',
                  (user_id, game['gameId'], compact(game['payload'])))
        if c.execute('SELECT user_id FROM player_reviewed_games WHERE game_id=?', (game['gameId'],)).fetchone()[0] != user_id:
            raise ValueError('reviewed game belongs to another account')
    for cycle in report['cycles']['historical']:
        # Retain earlier calibration evidence. New cycle keys also prevent a
        # later current-Ace review from counting the historical cycle twice.
        c.execute('INSERT INTO dynamic_profile_cycles SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM dynamic_profile_cycles WHERE user_id=? AND session_id=? AND first_hand_number=?)',
                  (user_id, cycle['model'], cycle['gameId'], cycle['firstHand'], compact(cycle['sample']), cycle['at'], user_id, cycle['gameId'], cycle['firstHand']))
    for game in report['gameLengths']:
        c.execute('INSERT INTO dynamic_profile_games SELECT ?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM dynamic_profile_games WHERE user_id=? AND session_id=?)',
                  (user_id, 'player-history', game['gameId'], compact({'cyclesPerGame': game['cyclesPerGame']}), game['at'], user_id, game['gameId']))
    c.execute('UPDATE dynamic_player_profiles SET profile_json=?,updated_at=? WHERE user_id=? AND evaluator_version=?',
              (compact(profile), at, user_id, expected['evaluator_version']))
    c.commit()
    result['backup'] = str(backup)
    result['reportSha256'] = hashlib.sha256(compact(report).encode()).hexdigest()
    return result


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--database', type=Path, required=True)
    p.add_argument('--report', type=Path, required=True)
    p.add_argument('--user-id', type=int, required=True)
    p.add_argument('--username', required=True)
    p.add_argument('--backup', type=Path, required=True)
    p.add_argument('--apply', action='store_true')
    args = p.parse_args()
    result = apply_report(args.database, json.loads(args.report.read_text()), args.user_id, args.username, args.backup, args.apply)
    print(json.dumps(result))


if __name__ == '__main__':
    main()
