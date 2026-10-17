import { useEffect, useState } from 'react';
import { View, type AccessibilityActionEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Ellipse, Line, Text as SvgText } from 'react-native-svg';
import { scheduleOnRN } from 'react-native-worklets';

import { s } from '../i18n';
import {
  MAX_SEMITONES,
  describeResult,
  formatAccessibility,
  isNeutral,
  noteForSemitones,
  signed,
  type Tuning,
} from '../lib/tuning';
import { useColors } from '../theme';
import { fonts } from '../theme/type';
import { tick } from './Controls';

type Props = {
  /** Controlled: everything drawn derives from this value. */
  tuning: Tuning;
  onChangeSemitones: (n: number) => void;
};

const HALF = 6; // half a staff space
const SPACE = HALF * 2;
// Headroom above the top line: the G clef rises ~2 spaces over the staff, A5 sits on a ledger above it.
const TOP = 44; // y of the top staff line
const BOTTOM_Y = TOP + 8 * HALF; // y of the bottom line (E4, step 0)
const HEIGHT = 152;
const LABEL_Y = BOTTOM_Y + 4 * HALF + 20;
const REF_STEP = 3; // A4
const MUSIC_SIZE = SPACE * 4;
const EASE = Easing.out(Easing.cubic);

const yForStep = (step: number) => BOTTOM_Y - step * HALF;
const clamp = (n: number) => Math.min(MAX_SEMITONES, Math.max(-MAX_SEMITONES, n));

function ledgerSteps(step: number): number[] {
  const out: number[] = [];
  if (step <= -2) for (let q = -2; q >= step; q -= 2) out.push(q);
  if (step >= 10) for (let q = 10; q <= step; q += 2) out.push(q);
  return out;
}

export function TuningStaff({ tuning, onChangeSemitones }: Props) {
  const colors = useColors();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);

  const value = tuning.semitones;
  const note = noteForSemitones(value);
  const neutral = isNeutral(tuning);
  const noteColor = neutral ? colors.ink : colors.tint;
  const caption = describeResult(tuning);

  // Shared mirrors of the controlled value, read by gesture worklets only.
  const current = useSharedValue(value);
  const noteY = useSharedValue(yForStep(note.step));
  const startValue = useSharedValue(value);
  const lastEmitted = useSharedValue(value);
  const ty = useSharedValue(yForStep(note.step) - BOTTOM_Y);

  useEffect(() => {
    current.set(value);
    noteY.set(yForStep(note.step));
    const target = yForStep(note.step) - BOTTOM_Y;
    ty.set(reduced ? target : withTiming(target, { duration: 120, easing: EASE }));
  }, [value, note.step, reduced, current, noteY, ty]);

  const movingStyle = useAnimatedStyle(() => ({ transform: [{ translateY: ty.get() }] }));

  const emit = (n: number) => {
    onChangeSemitones(n);
    tick();
  };

  const pan = Gesture.Pan()
    .minDistance(8)
    .onBegin(() => {
      startValue.set(current.get());
      lastEmitted.set(current.get());
    })
    .onUpdate((e) => {
      const n = Math.min(MAX_SEMITONES, Math.max(-MAX_SEMITONES, startValue.get() - Math.round(e.translationY / SPACE)));
      if (n !== lastEmitted.get()) {
        lastEmitted.set(n);
        scheduleOnRN(emit, n);
      }
    });

  const tap = Gesture.Tap().onEnd((e, success) => {
    if (!success) return;
    const n = Math.min(MAX_SEMITONES, Math.max(-MAX_SEMITONES, current.get() + (e.y < noteY.get() ? 1 : -1)));
    if (n !== current.get()) scheduleOnRN(emit, n);
  });

  const gesture = Gesture.Race(pan, tap);

  const onAction = (e: AccessibilityActionEvent) => {
    const n = clamp(value + (e.nativeEvent.actionName === 'increment' ? 1 : -1));
    if (n !== value) emit(n);
  };

  // Centre of the writable staff (after the clef, before the closing bar line).
  const CLEF_END = 64;
  const center = (CLEF_END + width - 4) / 2;
  const pair = Math.min(56, (width - CLEF_END) / 5); // half distance ref ↔ note when both are drawn
  const refX = center - pair;
  const noteX = value === 0 ? center : center + pair;
  const refLabel = s.tuning.refLabel(tuning.refHz);
  const ledgers = ledgerSteps(note.step);
  // The layer is translated by (yForStep(step) − BOTTOM_Y), so ledgers are drawn counter-offset.
  const ledgerY = (q: number) => yForStep(q) - (yForStep(note.step) - BOTTOM_Y);
  const hairline = 1;

  return (
    <GestureDetector gesture={gesture}>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={s.tuning.staffLabel}
        accessibilityValue={{ text: `${caption}, ${formatAccessibility(tuning)}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAction}
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        style={{ height: HEIGHT, width: '100%' }}>
        {width > 0 ? (
          <>
            <Svg width={width} height={HEIGHT} style={{ position: 'absolute' }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <Line
                  key={i}
                  x1={4}
                  x2={width - 4}
                  y1={TOP + i * SPACE}
                  y2={TOP + i * SPACE}
                  stroke={colors.ink}
                  strokeWidth={hairline}
                />
              ))}
              {[4, width - 4].map((bx) => (
                <Line key={bx} x1={bx} x2={bx} y1={TOP} y2={BOTTOM_Y} stroke={colors.ink} strokeWidth={1.5} />
              ))}
              {/* Treble clef: the spiral of the G clef sits on the second line (G4, step 2). */}
              <SvgText
                x={14}
                y={yForStep(2)}
                fontFamily={fonts.music}
                fontSize={MUSIC_SIZE}
                fill={colors.ink}>
                {'\u{1D11E}'}
              </SvgText>
              {value !== 0 ? (
                <>
                  <Ellipse
                    cx={refX}
                    cy={yForStep(REF_STEP)}
                    rx={7.5}
                    ry={5.5}
                    rotation={-20}
                    origin={`${refX}, ${yForStep(REF_STEP)}`}
                    fill="none"
                    stroke={colors.pencil}
                    strokeWidth={1.5}
                  />
                  <SvgText
                    x={refX}
                    y={LABEL_Y}
                    fontFamily={fonts.caslon}
                    fontSize={12}
                    fill={colors.pencil}
                    textAnchor="middle">
                    {refLabel}
                  </SvgText>
                </>
              ) : (
                <SvgText
                  x={noteX}
                  y={LABEL_Y}
                  fontFamily={fonts.caslon}
                  fontSize={12}
                  fill={colors.pencil}
                  textAnchor="middle">
                  {refLabel}
                </SvgText>
              )}
            </Svg>

            {/* The transposed note: drawn at E4 and translated, so only the move between positions animates. */}
            <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 0 }, movingStyle]}>
              <Svg width={width} height={HEIGHT} style={{ overflow: 'visible' }}>
                {ledgers.map((q) => (
                  <Line
                    key={q}
                    x1={noteX - 12}
                    x2={noteX + 12}
                    y1={ledgerY(q)}
                    y2={ledgerY(q)}
                    stroke={colors.ink}
                    strokeWidth={hairline * 1.5}
                  />
                ))}
                {note.accidental ? (
                  <SvgText
                    x={noteX - 28}
                    y={BOTTOM_Y}
                    fontFamily={fonts.music}
                    fontSize={MUSIC_SIZE * 0.6}
                    fill={noteColor}>
                    {note.accidental === 'sharp' ? '♯' : '♭'}
                  </SvgText>
                ) : null}
                <Ellipse
                  cx={noteX}
                  cy={BOTTOM_Y}
                  rx={7.5}
                  ry={5.5}
                  rotation={-20}
                  origin={`${noteX}, ${BOTTOM_Y}`}
                  fill={noteColor}
                />
                {tuning.cents !== 0 ? (
                  <SvgText
                    x={noteX + 16}
                    y={BOTTOM_Y + 4}
                    fontFamily={fonts.caslonItalic}
                    fontSize={13}
                    fill={colors.pencil}>
                    {`${signed(tuning.cents)}¢`}
                  </SvgText>
                ) : null}
              </Svg>
            </Animated.View>
          </>
        ) : null}
      </View>
    </GestureDetector>
  );
}
