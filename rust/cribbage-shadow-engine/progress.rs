//! Optional, decision-local progress. Search publishes batches, never per-node callbacks.
use std::cell::RefCell;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

pub const CANCELLED_ERROR: &str = "Opening calculation was cancelled.";

#[derive(Default)]
pub struct DecisionProgress {
    total: AtomicUsize,
    completed: AtomicUsize,
    cancelled: AtomicBool,
}

impl DecisionProgress {
    /// Obsolete work must return an error, never a partially evaluated move.
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::Release);
    }

    pub fn check_cancelled(&self) -> Result<(), String> {
        if self.cancelled.load(Ordering::Acquire) {
            Err(CANCELLED_ERROR.into())
        } else {
            Ok(())
        }
    }

    pub fn snapshot(&self) -> (usize, usize) {
        let total = self.total.load(Ordering::Acquire);
        (self.completed.load(Ordering::Relaxed).min(total), total)
    }

    pub(crate) fn begin(&self, total: usize) {
        self.completed.store(0, Ordering::Relaxed);
        self.total.store(total, Ordering::Release);
    }

    pub(crate) fn complete(&self, completed: usize) {
        self.completed.store(completed, Ordering::Relaxed);
    }
}

thread_local! {
    static CURRENT: RefCell<Option<Arc<DecisionProgress>>> = const { RefCell::new(None) };
}

pub(crate) fn current() -> Option<Arc<DecisionProgress>> {
    CURRENT.with(|slot| slot.borrow().clone())
}

/// Scope the observer to this solve, including unwinding and nested callers.
pub fn with_progress<T>(progress: Arc<DecisionProgress>, solve: impl FnOnce() -> T) -> T {
    struct Reset(Option<Arc<DecisionProgress>>);
    impl Drop for Reset {
        fn drop(&mut self) {
            CURRENT.with(|slot| *slot.borrow_mut() = self.0.take());
        }
    }
    let _reset = Reset(CURRENT.with(|slot| slot.replace(Some(progress))));
    solve()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cancellation_survives_progress_updates_and_stays_local_to_its_job() {
        let cancelled = DecisionProgress::default();
        let active = DecisionProgress::default();
        cancelled.cancel();
        cancelled.begin(100);
        cancelled.complete(20);
        assert_eq!(cancelled.check_cancelled(), Err(CANCELLED_ERROR.into()));
        assert_eq!(active.check_cancelled(), Ok(()));
        assert_eq!(cancelled.snapshot(), (20, 100));
    }

    #[test]
    fn observers_are_scoped_and_thread_local_even_after_unwinding() {
        let outer = Arc::new(DecisionProgress::default());
        with_progress(Arc::clone(&outer), || {
            let _ = std::panic::catch_unwind(|| {
                with_progress(Arc::new(DecisionProgress::default()), || panic!("test"));
            });
            assert!(Arc::ptr_eq(&current().unwrap(), &outer));
            assert!(std::thread::spawn(|| current().is_none()).join().unwrap());
        });
        assert!(current().is_none());
    }
}
