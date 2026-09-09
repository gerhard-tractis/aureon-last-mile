import { describe, it, expect } from 'vitest';
import { isVideoReady } from './cameraReadiness';

function makeVideo(width: number, height: number) {
  return { videoWidth: width, videoHeight: height } as HTMLVideoElement;
}

function makeTrack(readyState: 'live' | 'ended', muted: boolean) {
  return { readyState, muted } as MediaStreamTrack;
}

describe('isVideoReady', () => {
  it('is true when the video has real dimensions and the track is live and unmuted', () => {
    expect(isVideoReady(makeVideo(640, 480), makeTrack('live', false))).toBe(true);
  });

  it('is false when there is no video element', () => {
    expect(isVideoReady(null, makeTrack('live', false))).toBe(false);
  });

  it('is false when there is no track', () => {
    expect(isVideoReady(makeVideo(640, 480), null)).toBe(false);
  });

  it('is false when the video width is zero', () => {
    expect(isVideoReady(makeVideo(0, 480), makeTrack('live', false))).toBe(false);
  });

  it('is false when the video height is zero', () => {
    expect(isVideoReady(makeVideo(640, 0), makeTrack('live', false))).toBe(false);
  });

  it('is false when the track has ended', () => {
    expect(isVideoReady(makeVideo(640, 480), makeTrack('ended', false))).toBe(false);
  });

  it('is false when the track is muted', () => {
    expect(isVideoReady(makeVideo(640, 480), makeTrack('live', true))).toBe(false);
  });
});
