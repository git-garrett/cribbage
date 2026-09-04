#!/usr/bin/env python3
"""Focused tests for phase-suffix board-matrix transposition."""

from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("build-board-win-matrix.py")
SPEC = importlib.util.spec_from_file_location("build_board_win_matrix", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class BoardMatrixTranspositionTests(unittest.TestCase):
    def test_later_suffixes_add_population_near_corner(self) -> None:
        events = []
        for _ in range(61):
            events.extend(((0, 2), (1, 2)))
        full = MODULE.seam_sample(events, 0, 0)
        later = MODULE.seam_sample(events, 2, 0)
        aggregate = MODULE.MatrixAggregate("test", "discard")
        observations, wins = MODULE.cluster_matrices([full, later])
        MODULE.add_cluster_to([aggregate], observations, wins, source_games=1)

        self.assertEqual(aggregate.observations[0][0], 1)
        self.assertEqual(aggregate.observations[120][120], 2)
        self.assertEqual(aggregate.wins[0][0], 1)
        self.assertEqual(aggregate.wins[120][120], 2)

    def test_suffix_orientation_is_the_current_hands_dealer(self) -> None:
        events = [(0, 1), (1, 1)]
        left_deals = MODULE.seam_sample(events, 0, 0)
        right_deals = MODULE.seam_sample(events, 0, 1)

        self.assertEqual(left_deals.dealer_win_cutoffs[120], 120)
        self.assertEqual(right_deals.dealer_win_cutoffs[120], 119)

    def test_cutoffs_match_direct_event_replay(self) -> None:
        event_sets = [
            [(0, 3), (1, 2), (0, 1), (1, 4)],
            [(1, 5), (0, 2), (1, 1), (0, 6)],
        ]
        for events in event_sets:
            for dealer in (0, 1):
                sample = MODULE.seam_sample(events, 0, dealer)
                for dealer_score in range(sample.minimum_dealer_score, 121):
                    for pone_score in range(sample.minimum_pone_score, 121):
                        scores = (
                            [dealer_score, pone_score]
                            if dealer == 0
                            else [pone_score, dealer_score]
                        )
                        winner = None
                        for player, points in events:
                            scores[player] += points
                            if scores[player] >= 121:
                                winner = player
                                break
                        self.assertIsNotNone(winner)
                        expected = winner == dealer
                        actual = pone_score <= sample.dealer_win_cutoffs[dealer_score]
                        self.assertEqual(
                            actual,
                            expected,
                            (events, dealer, dealer_score, pone_score),
                        )


if __name__ == "__main__":
    unittest.main()
