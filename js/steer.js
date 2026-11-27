// Mirror steering tracker (v35). Turns the controller's pointing direction (in the battle room's frame)
// into a ship orientation (also in the room frame), scaled by the steering gain.
//
// Up to v34 this was a straight yaw / pitch split: ship = Ry(gain * yaw) * Rx(gain * pitch). That map is
// singular when the controller points near straight up or down (or the ship gets there first, at gain 3
// a 60-degree tilt is enough): a tiny wrist movement there is a huge yaw change, times the gain, so the
// fleet spun and the aim line went wild, and a quick flick could fool the "over the top" guess.
//
// Now it is delta based:
//   - The controller is tracked as a frame that is carried along from frame to frame by the smallest
//     rotation between its old and new pointing direction (no Euler angles, so nothing wraps or flips).
//   - Each frame, that small rotation, seen from the controller itself (left / right / up / down, no
//     roll), is scaled by the gain and applied to the ship the same way, seen from the ship.
//   - Away from straight up / down, the ship is held on the old absolute map (pointing at the room's
//     front is straight ahead, a yaw keeps the ship level), so the feel is the same as before. Any
//     difference left after a trip past the vertical is eased out at a limited turn rate - never a jump.
//   - A single frame that moves the controller absurdly far (tracking glitch, re-centre) is not passed
//     on to the ship.
import * as THREE from '../vendor/three.module.js';

const TAU = Math.PI * 2;
const wrapPi = (a) => a - Math.round(a / TAU) * TAU;
const YAXIS = new THREE.Vector3(0, 1, 0), XAXIS = new THREE.Vector3(1, 0, 0);
const POLE_IN = 0.9, POLE_OUT = 1.15;     // |pitch| where the absolute map fades out (rad)
const PULL_RATE = 1.6;                    // rad/s: how fast a leftover offset is eased out
const GLITCH = 0.6;                       // rad in one frame: ignore for the ship

const _f = new THREE.Vector3(), _u = new THREE.Vector3(), _lu = new THREE.Vector3(), _v = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _qt = new THREE.Quaternion(), _qd = new THREE.Quaternion();
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion(), _qs1 = new THREE.Quaternion(), _qs2 = new THREE.Quaternion();
const _ql = new THREE.Quaternion(), _qo = new THREE.Quaternion();

export function createSteer() {
  return {
    init: false,
    frame: new THREE.Quaternion(),     // controller frame, carried along (room frame)
    ship: new THREE.Quaternion(),      // ship rotation in the room frame (applied to the ship's neutral)
    abs: new THREE.Quaternion(),       // the absolute map last frame
    yaw: 0, pitch: 0, over: false, lastYaw: 0, lastPitchEff: 0, w: 1, gain: 0,
  };
}

// q^g for a unit quaternion (scale its rotation angle).
function powQ(q, g, out) {
  let { x, y, z, w } = q;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const s = Math.hypot(x, y, z);
  if (s < 1e-9) return out.identity();
  const ang = 2 * Math.atan2(s, w);
  return out.setFromAxisAngle(_v.set(x / s, y / s, z / s), ang * g);
}
function levelFrame(yaw, pitch, out) {
  return out.setFromAxisAngle(YAXIS, yaw).multiply(_qo.setFromAxisAngle(XAXIS, pitch));
}
function absMap(tr, g, out) {
  return out.setFromAxisAngle(YAXIS, g * tr.yaw).multiply(_qo.setFromAxisAngle(XAXIS, g * tr.pitch));
}
const angleBetween = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a.dot(b))));

// One step. ctrlQ: controller world quaternion; nQ: the room's neutral (front, level); g: gain.
// Returns tr.ship (room-frame rotation). dt is used for the ease-out only.
export function steerStep(tr, ctrlQ, nQ, g, dt = 1 / 72) {
  _f.set(0, 0, -1).applyQuaternion(ctrlQ).applyQuaternion(_qi.copy(nQ).invert()).normalize();
  const h = Math.hypot(_f.x, _f.z), pitch = Math.atan2(_f.y, h);
  const rawYaw = h > 1e-6 ? Math.atan2(-_f.x, -_f.z) : tr.lastYaw;
  if (!tr.init || tr.gain !== g) {
    // (A gain change re-bases the ship on the absolute map: it's a settings change, done between flights.)
    tr.init = true; tr.gain = g; tr.over = false;
    tr.yaw = rawYaw; tr.lastYaw = rawYaw; tr.pitch = pitch; tr.lastPitchEff = pitch;
    levelFrame(rawYaw, pitch, tr.frame);
    absMap(tr, g, tr.ship); tr.abs.copy(tr.ship); tr.w = 1;
    return tr.ship;
  }
  // 1) Carry the controller frame to the new pointing direction (smallest rotation).
  _u.set(0, 0, -1).applyQuaternion(tr.frame);
  _qd.setFromUnitVectors(_u, _f);
  const moved = 2 * Math.acos(Math.min(1, Math.abs(_qd.w)));
  _qt.copy(_qd).multiply(tr.frame);                     // carried frame
  _ql.copy(tr.frame).invert().multiply(_qt);           // the step, seen from the controller
  tr.frame.copy(_qt).normalize();
  // 2) Over the top or not: whichever level frame (upright or upside down) is closer to the carried one.
  if (h > 1e-6) {
    _lu.set(0, 1, 0).addScaledVector(_f, -_f.y).normalize();       // "up" of the upright frame
    _u.set(0, 1, 0).applyQuaternion(tr.frame);
    const over = _u.dot(_lu) < 0;
    const yawEff = rawYaw + (over ? Math.PI : 0);
    const yawEffPrev = tr.lastYaw + (tr.over ? Math.PI : 0);
    tr.yaw += wrapPi(yawEff - yawEffPrev);
    tr.over = over; tr.lastYaw = rawYaw;
  }
  // Pitch is unwrapped too (over the top it keeps going past 90 degrees, and on round, without a jump).
  const pitchEff = tr.over ? Math.PI - pitch : pitch;
  tr.pitch += wrapPi(pitchEff - tr.lastPitchEff);
  tr.lastPitchEff = pitchEff;
  // Away from the vertical, drop the carried roll (it's invisible: only how the next step is read).
  const ap = Math.abs(pitch);
  const w = ap <= POLE_IN ? 1 : ap >= POLE_OUT ? 0 : 1 - (ap - POLE_IN) / (POLE_OUT - POLE_IN);
  if (ap < POLE_OUT) {
    levelFrame(tr.over ? rawYaw + Math.PI : rawYaw, tr.over ? Math.PI - pitch : pitch, _qa);
    if (_qa.dot(tr.frame) < 0) _qa.set(-_qa.x, -_qa.y, -_qa.z, -_qa.w);
    tr.frame.copy(_qa);
  }
  // 3) Move the ship: absolute-map change (w) blended with the scaled local step (1 - w).
  absMap(tr, g, _qa);
  if (moved < GLITCH) {
    _qs1.copy(_qa).multiply(_qb.copy(tr.abs).invert()).multiply(tr.ship);    // same change as the map
    _qs2.copy(tr.ship).multiply(powQ(_ql, g, _qb));                         // scaled local step
    if (_qs1.dot(_qs2) < 0) _qs1.set(-_qs1.x, -_qs1.y, -_qs1.z, -_qs1.w);
    tr.ship.copy(_qs2).slerp(_qs1, w).normalize();
  }
  tr.abs.copy(_qa);
  // 4) Ease any leftover offset out (only where the absolute map is good).
  if (w > 0) {
    const e = angleBetween(tr.ship, _qa);
    if (e > 1e-5) {
      if (tr.ship.dot(_qa) < 0) _qa.set(-_qa.x, -_qa.y, -_qa.z, -_qa.w);
      tr.ship.slerp(_qa, Math.min(1, (w * PULL_RATE * dt) / e)).normalize();
    }
  }
  tr.w = w;
  // Drop whole extra turns when that can't move the ship (whole-number gain * turns), near the front.
  const k = Math.round((tr.yaw - wrapPi(tr.yaw)) / TAU);
  if (k && !tr.over && Math.abs(wrapPi(tr.yaw)) < 0.8 && Math.abs(g * k - Math.round(g * k)) < 1e-9) {
    tr.yaw -= k * TAU;
    absMap(tr, g, tr.abs);
  }
  const kp = Math.round((tr.pitch - wrapPi(tr.pitch)) / TAU);
  if (kp && !tr.over && Math.abs(wrapPi(tr.pitch)) < 0.8 && Math.abs(g * kp - Math.round(g * kp)) < 1e-9) {
    tr.pitch -= kp * TAU;
    absMap(tr, g, tr.abs);
  }
  return tr.ship;
}
