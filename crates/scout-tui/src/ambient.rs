//! Decorative light, separate from observed work. Never changes text or targets.
use std::time::{Duration, Instant};

use ratatui::{buffer::Buffer, style::Color};

use crate::theme::GROUND;

pub const TICK: Duration = Duration::from_millis(200);

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum Ambient {
    #[default]
    Off,
    Shimmer,
}

impl Ambient {
    pub fn parse(value: &str) -> Option<Self> {
        match value {
            "off" => Some(Self::Off),
            "shimmer" => Some(Self::Shimmer),
            _ => None,
        }
    }

    pub fn toggle(&mut self) {
        *self = if *self == Self::Off {
            Self::Shimmer
        } else {
            Self::Off
        };
    }

    pub fn paint(self, buffer: &mut Buffer, elapsed: Duration) {
        if self == Self::Off {
            return;
        }
        // Two slow diagonal light fields. Colors stay below selected-card fill.
        let phase = (elapsed.as_millis() / TICK.as_millis()) as usize;
        let area = buffer.area;
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                let cell = &mut buffer[(x, y)];
                if cell.bg != GROUND {
                    continue; // Preserve selected cards, requests, and overlays.
                }
                let diagonal = (usize::from(x) + usize::from(y) * 2 + phase) % 160;
                let distance = diagonal.abs_diff(80);
                let light = 28usize.saturating_sub(distance) / 4;
                cell.set_bg(Color::Rgb(
                    12 + light as u8,
                    10 + light as u8 * 2,
                    8 + light as u8 * 3,
                ));
            }
        }
    }
}

/// Pause decorative motion when the terminal loses focus, including on redraws.
pub struct Clock {
    elapsed: Duration,
    resumed: Option<Instant>,
}

impl Clock {
    pub fn new(now: Instant) -> Self {
        Self {
            elapsed: Duration::ZERO,
            resumed: Some(now),
        }
    }

    pub fn elapsed(&self, now: Instant) -> Duration {
        self.elapsed
            + self
                .resumed
                .map(|start| now.saturating_duration_since(start))
                .unwrap_or_default()
    }

    pub fn focus(&mut self, focused: bool, now: Instant) {
        match (focused, self.resumed) {
            (false, Some(_)) => {
                self.elapsed = self.elapsed(now);
                self.resumed = None;
            }
            (true, None) => self.resumed = Some(now),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::{
        layout::Rect,
        style::{Modifier, Style},
    };

    #[test]
    fn light_preserves_content_and_selected_surface() {
        let mut buffer = Buffer::empty(Rect::new(0, 0, 100, 10));
        buffer.set_style(buffer.area, Style::default().bg(GROUND));
        buffer[(60, 5)].set_symbol("λ").set_style(
            Style::default()
                .fg(Color::White)
                .add_modifier(Modifier::BOLD),
        );
        buffer[(61, 5)].set_bg(crate::theme::HEARTH);
        let before = buffer.clone();
        Ambient::Off.paint(&mut buffer, Duration::ZERO);
        assert_eq!(buffer, before);
        Ambient::Shimmer.paint(&mut buffer, Duration::ZERO);
        assert_ne!(buffer, before);
        assert_eq!(buffer[(60, 5)].symbol(), "λ");
        assert_eq!(buffer[(60, 5)].fg, Color::White);
        assert_eq!(buffer[(60, 5)].modifier, Modifier::BOLD);
        assert_eq!(buffer[(61, 5)], before[(61, 5)]);
        for cell in buffer.content {
            if let Color::Rgb(r, g, b) = cell.bg {
                assert!(r <= 34 && g <= 28 && b <= 29);
            }
        }
    }

    #[test]
    fn clock_freezes_while_unfocused_and_resumes_without_jump() {
        let start = Instant::now();
        let mut clock = Clock::new(start);
        clock.focus(false, start + Duration::from_secs(3));
        assert_eq!(
            clock.elapsed(start + Duration::from_secs(99)),
            Duration::from_secs(3)
        );
        clock.focus(true, start + Duration::from_secs(100));
        assert_eq!(
            clock.elapsed(start + Duration::from_secs(101)),
            Duration::from_secs(4)
        );
    }
}
