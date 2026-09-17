import { describe, it, expect, vi } from 'vitest';
import { PlaybackController } from '../timeline/playbackController';
import { compileProjectTimeline } from '../timeline/compiler';
import { makeMinimalProject } from './fixtures';

function makeFakeScheduler() {
  let pendingCallback: FrameRequestCallback | null = null;
  let nextHandle = 1;
  const cancelled: number[] = [];
  return {
    requestAnimationFrame: (cb: FrameRequestCallback) => {
      pendingCallback = cb;
      return nextHandle++;
    },
    cancelAnimationFrame: (handle: number) => {
      cancelled.push(handle);
    },
    fireFrame(timestamp: number) {
      const cb = pendingCallback;
      pendingCallback = null;
      cb?.(timestamp);
    },
    get cancelledHandles() {
      return cancelled;
    },
  };
}

function makeFakeClock(startAt = 0) {
  let current = startAt;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

describe('PlaybackController', () => {
  const timeline = compileProjectTimeline(makeMinimalProject());

  it('play() advances currentTimeMs by now() deltas across multiple frames', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });

    controller.play();
    clock.advance(500);
    scheduler.fireFrame(500);
    expect(controller.currentTimeMs).toBe(500);

    clock.advance(300);
    scheduler.fireFrame(800);
    expect(controller.currentTimeMs).toBe(800);

    controller.destroy();
  });

  it('pause() stops advancing and a later play() resumes from the paused time', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });

    controller.play();
    clock.advance(400);
    scheduler.fireFrame(400);
    expect(controller.currentTimeMs).toBe(400);

    controller.pause();
    clock.advance(10_000);
    expect(controller.currentTimeMs).toBe(400);
    expect(controller.isPlaying).toBe(false);

    controller.play();
    clock.advance(100);
    scheduler.fireFrame(100);
    expect(controller.currentTimeMs).toBe(500);

    controller.destroy();
  });

  it('seek() updates currentTimeMs and notifies subscribers without requiring play()', () => {
    const controller = new PlaybackController(timeline);
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.seek(1200);

    expect(controller.currentTimeMs).toBe(1200);
    expect(controller.isPlaying).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][1]).toBe(1200);

    controller.destroy();
  });

  it('reaching totalDurationMs auto-pauses', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });

    controller.play();
    clock.advance(timeline.totalDurationMs + 5000);
    scheduler.fireFrame(timeline.totalDurationMs + 5000);

    expect(controller.currentTimeMs).toBe(timeline.totalDurationMs);
    expect(controller.isPlaying).toBe(false);

    controller.destroy();
  });

  it('notifies multiple subscribers on every notification', () => {
    const controller = new PlaybackController(timeline);
    const a = vi.fn();
    const b = vi.fn();
    controller.subscribe(a);
    controller.subscribe(b);

    controller.seek(300);

    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);

    controller.destroy();
  });

  it('destroy() stops future notifications and cancels the pending frame', () => {
    const scheduler = makeFakeScheduler();
    const clock = makeFakeClock(0);
    const controller = new PlaybackController(timeline, {
      requestAnimationFrame: scheduler.requestAnimationFrame,
      cancelAnimationFrame: scheduler.cancelAnimationFrame,
      now: clock.now,
    });
    const listener = vi.fn();
    controller.subscribe(listener);

    controller.play();
    const cancelledBefore = scheduler.cancelledHandles.length;
    controller.destroy();

    expect(scheduler.cancelledHandles.length).toBe(cancelledBefore + 1);

    controller.seek(999);
    expect(listener).not.toHaveBeenCalled();
  });
});
