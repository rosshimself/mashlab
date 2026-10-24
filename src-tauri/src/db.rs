//! Local SQLite storage: profiles, runs and raw input events.

use crate::stats::RunStats;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;

pub struct Db {
    conn: Connection,
}

#[derive(Debug, Clone, Serialize)]
pub struct Profile {
    pub id: i64,
    pub name: String,
    pub created_at: i64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Fixed duration; `target` is seconds.
    Time,
    /// Fixed number of presses; `target` is press count.
    Count,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::Time => "time",
            Mode::Count => "count",
        }
    }
    fn parse(s: &str) -> Mode {
        if s == "count" { Mode::Count } else { Mode::Time }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct RunSummary {
    pub id: i64,
    pub profile_id: i64,
    pub started_at: i64,
    pub mode: Mode,
    pub target: u32,
    pub button: String,
    pub controller: String,
    #[serde(flatten)]
    pub stats: RunStats,
}

#[derive(Debug, Clone, Serialize)]
pub struct InputEvent {
    pub pressed: bool,
    pub t_ms: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct RunDetail {
    pub summary: RunSummary,
    pub events: Vec<InputEvent>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LeaderboardEntry {
    pub profile_id: i64,
    pub name: String,
    pub run_id: i64,
    pub mean_interval_ms: f64,
    pub consistency: f64,
    pub presses_per_sec: f64,
    pub started_at: i64,
}

pub struct NewRun<'a> {
    pub profile_id: i64,
    pub started_at: i64,
    pub mode: Mode,
    pub target: u32,
    pub button: &'a str,
    pub controller: &'a str,
    pub stats: &'a RunStats,
    pub events: &'a [InputEvent],
}

/// Runs need at least this many intervals to count toward bests and the leaderboard.
pub const MIN_INTERVALS_FOR_RANKING: i64 = 5;

const RUN_COLUMNS: &str = "id, profile_id, started_at, mode, target, button, controller,
    press_count, interval_count, span_ms, mean_interval_ms, median_interval_ms,
    min_interval_ms, max_interval_ms, stddev_ms, cv, consistency, presses_per_sec,
    best_window_ms, mean_hold_ms";

fn row_to_summary(r: &rusqlite::Row) -> rusqlite::Result<RunSummary> {
    let mode: String = r.get(3)?;
    Ok(RunSummary {
        id: r.get(0)?,
        profile_id: r.get(1)?,
        started_at: r.get(2)?,
        mode: Mode::parse(&mode),
        target: r.get(4)?,
        button: r.get(5)?,
        controller: r.get(6)?,
        stats: RunStats {
            press_count: r.get::<_, i64>(7)? as usize,
            interval_count: r.get::<_, i64>(8)? as usize,
            span_ms: r.get(9)?,
            mean_interval_ms: r.get(10)?,
            median_interval_ms: r.get(11)?,
            min_interval_ms: r.get(12)?,
            max_interval_ms: r.get(13)?,
            stddev_ms: r.get(14)?,
            cv: r.get(15)?,
            consistency: r.get(16)?,
            presses_per_sec: r.get(17)?,
            best_window_ms: r.get(18)?,
            mean_hold_ms: r.get(19)?,
        },
    })
}

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA foreign_keys = ON;
             CREATE TABLE IF NOT EXISTS profiles (
                 id INTEGER PRIMARY KEY,
                 name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                 created_at INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS settings (
                 key TEXT PRIMARY KEY,
                 value TEXT NOT NULL
             );
             CREATE TABLE IF NOT EXISTS runs (
                 id INTEGER PRIMARY KEY,
                 profile_id INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
                 started_at INTEGER NOT NULL,
                 mode TEXT NOT NULL,
                 target INTEGER NOT NULL,
                 button TEXT NOT NULL,
                 controller TEXT NOT NULL,
                 press_count INTEGER NOT NULL,
                 interval_count INTEGER NOT NULL,
                 span_ms REAL NOT NULL,
                 mean_interval_ms REAL NOT NULL,
                 median_interval_ms REAL NOT NULL,
                 min_interval_ms REAL NOT NULL,
                 max_interval_ms REAL NOT NULL,
                 stddev_ms REAL NOT NULL,
                 cv REAL NOT NULL,
                 consistency REAL NOT NULL,
                 presses_per_sec REAL NOT NULL,
                 best_window_ms REAL NOT NULL,
                 mean_hold_ms REAL
             );
             CREATE INDEX IF NOT EXISTS runs_profile ON runs(profile_id, started_at);
             CREATE TABLE IF NOT EXISTS run_events (
                 run_id INTEGER NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
                 seq INTEGER NOT NULL,
                 pressed INTEGER NOT NULL,
                 t_ms REAL NOT NULL,
                 PRIMARY KEY (run_id, seq)
             );",
        )?;
        Ok(Db { conn })
    }

    pub fn list_profiles(&self) -> rusqlite::Result<Vec<Profile>> {
        let mut st = self
            .conn
            .prepare("SELECT id, name, created_at FROM profiles ORDER BY name COLLATE NOCASE")?;
        st.query_map([], |r| Ok(Profile { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)? }))?
            .collect()
    }

    pub fn create_profile(&self, name: &str, now: i64) -> rusqlite::Result<Profile> {
        self.conn
            .execute("INSERT INTO profiles (name, created_at) VALUES (?1, ?2)", params![name, now])?;
        Ok(Profile { id: self.conn.last_insert_rowid(), name: name.to_string(), created_at: now })
    }

    pub fn profile(&self, id: i64) -> rusqlite::Result<Option<Profile>> {
        self.conn
            .query_row("SELECT id, name, created_at FROM profiles WHERE id = ?1", [id], |r| {
                Ok(Profile { id: r.get(0)?, name: r.get(1)?, created_at: r.get(2)? })
            })
            .optional()
    }

    pub fn active_profile_id(&self) -> rusqlite::Result<Option<i64>> {
        let v: Option<String> = self
            .conn
            .query_row("SELECT value FROM settings WHERE key = 'active_profile'", [], |r| r.get(0))
            .optional()?;
        Ok(v.and_then(|s| s.parse().ok()))
    }

    pub fn set_active_profile(&self, id: i64) -> rusqlite::Result<()> {
        self.conn.execute(
            "INSERT INTO settings (key, value) VALUES ('active_profile', ?1)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            [id.to_string()],
        )?;
        Ok(())
    }

    pub fn insert_run(&mut self, run: &NewRun) -> rusqlite::Result<i64> {
        let tx = self.conn.transaction()?;
        let s = run.stats;
        tx.execute(
            "INSERT INTO runs (profile_id, started_at, mode, target, button, controller,
                press_count, interval_count, span_ms, mean_interval_ms, median_interval_ms,
                min_interval_ms, max_interval_ms, stddev_ms, cv, consistency, presses_per_sec,
                best_window_ms, mean_hold_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)",
            params![
                run.profile_id,
                run.started_at,
                run.mode.as_str(),
                run.target,
                run.button,
                run.controller,
                s.press_count as i64,
                s.interval_count as i64,
                s.span_ms,
                s.mean_interval_ms,
                s.median_interval_ms,
                s.min_interval_ms,
                s.max_interval_ms,
                s.stddev_ms,
                s.cv,
                s.consistency,
                s.presses_per_sec,
                s.best_window_ms,
                s.mean_hold_ms,
            ],
        )?;
        let run_id = tx.last_insert_rowid();
        {
            let mut st =
                tx.prepare("INSERT INTO run_events (run_id, seq, pressed, t_ms) VALUES (?1, ?2, ?3, ?4)")?;
            for (i, e) in run.events.iter().enumerate() {
                st.execute(params![run_id, i as i64, e.pressed, e.t_ms])?;
            }
        }
        tx.commit()?;
        Ok(run_id)
    }

    pub fn list_runs(&self, profile_id: i64) -> rusqlite::Result<Vec<RunSummary>> {
        let mut st = self.conn.prepare(&format!(
            "SELECT {RUN_COLUMNS} FROM runs WHERE profile_id = ?1 ORDER BY started_at DESC"
        ))?;
        st.query_map([profile_id], row_to_summary)?.collect()
    }

    pub fn run_detail(&self, run_id: i64) -> rusqlite::Result<Option<RunDetail>> {
        let summary = self
            .conn
            .query_row(&format!("SELECT {RUN_COLUMNS} FROM runs WHERE id = ?1"), [run_id], row_to_summary)
            .optional()?;
        let Some(summary) = summary else { return Ok(None) };
        let mut st = self
            .conn
            .prepare("SELECT pressed, t_ms FROM run_events WHERE run_id = ?1 ORDER BY seq")?;
        let events = st
            .query_map([run_id], |r| Ok(InputEvent { pressed: r.get(0)?, t_ms: r.get(1)? }))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(Some(RunDetail { summary, events }))
    }

    pub fn delete_run(&self, run_id: i64) -> rusqlite::Result<()> {
        self.conn.execute("DELETE FROM runs WHERE id = ?1", [run_id])?;
        Ok(())
    }

    /// Lowest mean interval for a profile, excluding `exclude_run` (used for "new PB" checks).
    pub fn best_mean_interval(&self, profile_id: i64, exclude_run: i64) -> rusqlite::Result<Option<f64>> {
        self.conn.query_row(
            "SELECT MIN(mean_interval_ms) FROM runs
             WHERE profile_id = ?1 AND id != ?2 AND interval_count >= ?3",
            params![profile_id, exclude_run, MIN_INTERVALS_FOR_RANKING],
            |r| r.get(0),
        )
    }

    /// Each profile's best run, fastest first.
    pub fn leaderboard(&self) -> rusqlite::Result<Vec<LeaderboardEntry>> {
        let mut st = self.conn.prepare(
            "SELECT p.id, p.name, r.id, r.mean_interval_ms, r.consistency, r.presses_per_sec, r.started_at
             FROM profiles p
             JOIN runs r ON r.id = (
                 SELECT id FROM runs
                 WHERE profile_id = p.id AND interval_count >= ?1
                 ORDER BY mean_interval_ms ASC LIMIT 1
             )
             ORDER BY r.mean_interval_ms ASC",
        )?;
        st.query_map([MIN_INTERVALS_FOR_RANKING], |r| {
            Ok(LeaderboardEntry {
                profile_id: r.get(0)?,
                name: r.get(1)?,
                run_id: r.get(2)?,
                mean_interval_ms: r.get(3)?,
                consistency: r.get(4)?,
                presses_per_sec: r.get(5)?,
                started_at: r.get(6)?,
            })
        })?
        .collect()
    }
}
