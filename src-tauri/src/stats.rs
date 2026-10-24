//! Run statistics computed from raw press/release timestamps.

use serde::Serialize;

/// Number of consecutive intervals used for the "best window" metric.
pub const WINDOW: usize = 10;

#[derive(Debug, Clone, Serialize, Default)]
pub struct RunStats {
    pub press_count: usize,
    pub interval_count: usize,
    /// Time from first to last press.
    pub span_ms: f64,
    pub mean_interval_ms: f64,
    pub median_interval_ms: f64,
    pub min_interval_ms: f64,
    pub max_interval_ms: f64,
    pub stddev_ms: f64,
    /// Coefficient of variation (stddev / mean). Lower = more consistent.
    pub cv: f64,
    /// 0-100, derived from cv. Higher = more consistent.
    pub consistency: f64,
    pub presses_per_sec: f64,
    /// Best (lowest) mean over any WINDOW consecutive intervals.
    pub best_window_ms: f64,
    pub mean_hold_ms: Option<f64>,
}

fn mean(xs: &[f64]) -> f64 {
    xs.iter().sum::<f64>() / xs.len() as f64
}

fn median(xs: &[f64]) -> f64 {
    let mut v = xs.to_vec();
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n % 2 == 1 {
        v[n / 2]
    } else {
        (v[n / 2 - 1] + v[n / 2]) / 2.0
    }
}

/// `presses` and `releases` are milliseconds relative to the first press, sorted.
/// Returns None when there are fewer than two presses (no intervals).
pub fn compute(presses: &[f64], releases: &[f64]) -> Option<RunStats> {
    if presses.len() < 2 {
        return None;
    }
    let intervals: Vec<f64> = presses.windows(2).map(|w| w[1] - w[0]).collect();
    let m = mean(&intervals);
    let var = intervals.iter().map(|x| (x - m).powi(2)).sum::<f64>() / intervals.len() as f64;
    let sd = var.sqrt();
    let cv = if m > 0.0 { sd / m } else { 0.0 };

    let w = WINDOW.min(intervals.len());
    let best_window_ms = intervals
        .windows(w)
        .map(mean)
        .fold(f64::INFINITY, f64::min);

    // Pair each press with the first release after it (and before the next press).
    let mut holds = Vec::new();
    let mut ri = 0;
    for (i, &p) in presses.iter().enumerate() {
        while ri < releases.len() && releases[ri] < p {
            ri += 1;
        }
        if ri < releases.len() {
            let next_press = presses.get(i + 1).copied().unwrap_or(f64::INFINITY);
            if releases[ri] <= next_press {
                holds.push(releases[ri] - p);
                ri += 1;
            }
        }
    }

    Some(RunStats {
        press_count: presses.len(),
        interval_count: intervals.len(),
        span_ms: presses[presses.len() - 1] - presses[0],
        mean_interval_ms: m,
        median_interval_ms: median(&intervals),
        min_interval_ms: intervals.iter().copied().fold(f64::INFINITY, f64::min),
        max_interval_ms: intervals.iter().copied().fold(0.0, f64::max),
        stddev_ms: sd,
        cv,
        consistency: ((1.0 - cv) * 100.0).clamp(0.0, 100.0),
        presses_per_sec: if m > 0.0 { 1000.0 / m } else { 0.0 },
        best_window_ms,
        mean_hold_ms: if holds.is_empty() { None } else { Some(mean(&holds)) },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steady_mashing() {
        let presses: Vec<f64> = (0..11).map(|i| i as f64 * 80.0).collect();
        let releases: Vec<f64> = presses.iter().map(|p| p + 30.0).collect();
        let s = compute(&presses, &releases).unwrap();
        assert_eq!(s.interval_count, 10);
        assert!((s.mean_interval_ms - 80.0).abs() < 1e-9);
        assert!(s.stddev_ms < 1e-9);
        assert!((s.consistency - 100.0).abs() < 1e-9);
        assert!((s.presses_per_sec - 12.5).abs() < 1e-9);
        assert!((s.mean_hold_ms.unwrap() - 30.0).abs() < 1e-9);
    }

    #[test]
    fn best_window_finds_fastest_stretch() {
        let mut presses = vec![0.0];
        for i in 0..20 {
            let gap = if (5..15).contains(&i) { 60.0 } else { 100.0 };
            presses.push(presses.last().unwrap() + gap);
        }
        let s = compute(&presses, &[]).unwrap();
        assert!((s.best_window_ms - 60.0).abs() < 1e-9);
        assert!(s.mean_hold_ms.is_none());
    }

    #[test]
    fn needs_two_presses() {
        assert!(compute(&[0.0], &[]).is_none());
    }
}
