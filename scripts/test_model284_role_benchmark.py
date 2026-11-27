import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from model284_role_benchmark_stage import missing_ranges


class ResumeCoverage(unittest.TestCase):
    def test_out_of_order_commits_preserve_every_completed_index(self):
        self.assertEqual(missing_ranges([5, 0, 2], 6), [[1, 2], [3, 5]])

    def test_complete_and_empty_contracts(self):
        self.assertEqual(missing_ranges([0, 1, 2], 3), [])
        self.assertEqual(missing_ranges([], 3), [[0, 3]])

    def test_refuses_indices_from_another_contract(self):
        for indices in ([-1], [3]):
            with self.assertRaises(ValueError):
                missing_ranges(indices, 3)


if __name__ == '__main__':
    unittest.main()
