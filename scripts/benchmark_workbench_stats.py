"""Paired inference, with fixed bets chosen independently of benchmark data."""

import math


Z95 = 1.959963984540054
# Each signed product is a nonnegative martingale at the true conditional mean.
# Equal mixtures retain that property. Ville + alpha/2 per tail gives simultaneous
# 95% coverage at every pair count, without a normal approximation. See docs.
BETS = (0.01, 0.02, 0.04, 0.08, 0.16, 0.32, 0.64, 1.0)


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
