"""
Master archive runner — runs all three archive scripts in sequence.

Usage:
    python archive_all.py              # runs all three (picks requires service-account.json)
    python archive_all.py --no-picks   # skip picks (no Firebase auth needed)
    python archive_all.py --picks-only # only fetch picks from Firestore

The recommended first run:
    1. Add service-account.json to this folder (see README.md)
    2. python archive_all.py
"""

import argparse
import sys
import os

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
ARCHIVE_DIR = os.path.join(SCRIPT_DIR, '..', 'data-archive')


def main():
    parser = argparse.ArgumentParser(description='Archive all Majors Golf Pool tournament data to CSV.')
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--no-picks',    action='store_true', help='Skip picks (no Firebase auth needed)')
    group.add_argument('--picks-only',  action='store_true', help='Only fetch picks from Firestore')
    args = parser.parse_args()

    total_written = []
    total_missing = []
    total_skipped = []

    # ── Picks ──────────────────────────────────────────────────────────────────
    if not args.no_picks:
        print('\n' + '='*60)
        print('STEP 1: Picks (Firestore)')
        print('='*60)
        try:
            import archive_picks
            written = archive_picks.run()
            total_written.extend(written)
            print(f'\n  OK Picks done ({len(written)} files)')
        except SystemExit as e:
            print(f'\n  ERR Picks failed (exit code {e.code}). Use --no-picks to skip.')
            if not args.picks_only:
                print('  Continuing with scoreboard and standings...')
            else:
                sys.exit(e.code)
        except Exception as e:
            print(f'\n  ERR Picks error: {e}')
            if args.picks_only:
                sys.exit(1)
    else:
        print('\nSkipping picks (--no-picks)')

    if args.picks_only:
        print_summary(total_written, [], [])
        return

    # ── Scoreboard ────────────────────────────────────────────────────────────
    print('\n' + '='*60)
    print('STEP 2: Scoreboards (ESPN API)')
    print('='*60)
    try:
        import archive_scoreboard
        written, skipped = archive_scoreboard.run()
        total_written.extend(written)
        total_skipped.extend(skipped)
        print(f'\n  OK Scoreboards done ({len(written)} files)')
    except Exception as e:
        print(f'\n  ERR Scoreboards error: {e}')

    # ── Standings ─────────────────────────────────────────────────────────────
    print('\n' + '='*60)
    print('STEP 3: Pool Standings (standings.js)')
    print('='*60)
    try:
        import archive_standings
        written, missing = archive_standings.run()
        total_written.extend(written)
        total_missing.extend(missing)
        print(f'\n  OK Standings done ({len(written)} files)')
    except Exception as e:
        print(f'\n  ERR Standings error: {e}')

    print_summary(total_written, total_missing, total_skipped)


def print_summary(written, missing, skipped):
    print('\n' + '='*60)
    print(f'SUMMARY: {len(written)} files written to data-archive/')
    print('='*60)

    if written:
        archive_root = os.path.normpath(ARCHIVE_DIR)
        for path in sorted(written):
            rel = os.path.relpath(path, archive_root)
            print(f'  OK {rel}')

    if skipped:
        print(f'\nScoreboard skipped (missing ESPN event ID):')
        for name in skipped:
            print(f'  ! {name}')
        print('  -> Fill in espnEventId in tournaments_config.json and re-run archive_scoreboard.py')

    if missing:
        print(f'\nStandings not yet in standings.js:')
        for name in missing:
            print(f'  - {name}')


if __name__ == '__main__':
    os.chdir(SCRIPT_DIR)
    main()
