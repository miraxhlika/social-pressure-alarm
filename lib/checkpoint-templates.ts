import { RepeatSchedule, UseCaseType } from '@/types/alarm';

export type CheckpointTemplate = {
  id: UseCaseType;
  title: string;
  shortTitle: string;
  description: string;
  defaultLabel: string;
  repeatSchedule: RepeatSchedule;
  gracePeriodSeconds: number;
  coaching: string;
};

export type CheckpointLiveCopy = {
  title: string;
  description: string;
  warningDescription: string;
  criticalDescription: string;
  focusBody: string;
  permissionTitle: string;
  permissionDescription: string;
  wrongCodeTitle: string;
  wrongCodeDescription: string;
};

export const DEFAULT_USE_CASE_TYPE: UseCaseType = 'custom';

/** Reach window after the reminder fires — long enough to walk to a real checkpoint. */
export const FIRST_RUN_GRACE_SECONDS = 600;

const CHECKPOINT_TEMPLATE_MAP: Record<UseCaseType, CheckpointTemplate> = {
  wake_up: {
    id: 'wake_up',
    title: 'Wake up',
    shortTitle: 'Wake-up',
    description: 'Force yourself out of bed and all the way to a real checkpoint.',
    defaultLabel: 'Bathroom sink',
    repeatSchedule: 'weekdays',
    gracePeriodSeconds: 600,
    coaching: 'Best when the code is far enough away that you must stand up and move.',
  },
  medication: {
    id: 'medication',
    title: 'Medication',
    shortTitle: 'Medication',
    description: 'Make the proof happen where the medication actually lives.',
    defaultLabel: 'Medicine cabinet',
    repeatSchedule: 'daily',
    gracePeriodSeconds: 600,
    coaching: 'A scan only confirms a check-in near the medication; it does not confirm that a dose was taken.',
  },
  study_start: {
    id: 'study_start',
    title: 'Study start',
    shortTitle: 'Study',
    description: 'Turn “I should start” into a clear beginning with physical proof.',
    defaultLabel: 'Desk',
    repeatSchedule: 'weekdays',
    gracePeriodSeconds: 300,
    coaching: 'Place the code where starting work means you are really in position.',
  },
  deep_work: {
    id: 'deep_work',
    title: 'Deep work',
    shortTitle: 'Deep work',
    description: 'Protect focused work with a checkpoint that starts a serious block.',
    defaultLabel: 'Workstation',
    repeatSchedule: 'weekdays',
    gracePeriodSeconds: 300,
    coaching: 'Choose a checkpoint that marks the start of a no-distraction session.',
  },
  leave_home: {
    id: 'leave_home',
    title: 'Leave on time',
    shortTitle: 'Leave on time',
    description: 'Use the front door or bag area so leaving becomes the proof moment.',
    defaultLabel: 'Front door',
    repeatSchedule: 'weekdays',
    gracePeriodSeconds: 300,
    coaching: 'Keep the code at the exit so leaving and scanning stay in one motion.',
  },
  workout: {
    id: 'workout',
    title: 'Workout',
    shortTitle: 'Workout',
    description: 'Make the first physical step of training impossible to fake.',
    defaultLabel: 'Gym bag',
    repeatSchedule: 'daily',
    gracePeriodSeconds: 600,
    coaching: 'Use the bag, mat, or door so the checkpoint proves you started moving.',
  },
  custom: {
    id: 'custom',
    title: 'Custom',
    shortTitle: 'Custom',
    description: 'Start neutral, then tune the checkpoint for your own routine.',
    defaultLabel: '',
    repeatSchedule: 'daily',
    gracePeriodSeconds: 300,
    coaching: 'Useful when your commitment does not fit the standard templates yet.',
  },
};

const VALID_USE_CASE_TYPES = new Set<UseCaseType>(Object.keys(CHECKPOINT_TEMPLATE_MAP) as UseCaseType[]);

export const CHECKPOINT_TEMPLATES = [
  CHECKPOINT_TEMPLATE_MAP.wake_up,
  CHECKPOINT_TEMPLATE_MAP.leave_home,
  CHECKPOINT_TEMPLATE_MAP.study_start,
  CHECKPOINT_TEMPLATE_MAP.workout,
  CHECKPOINT_TEMPLATE_MAP.medication,
  CHECKPOINT_TEMPLATE_MAP.deep_work,
  CHECKPOINT_TEMPLATE_MAP.custom,
] as const;

/** Curated first-run choices — keep the decision set small. */
export const FIRST_CHECKPOINT_TEMPLATES = [
  CHECKPOINT_TEMPLATE_MAP.wake_up,
  CHECKPOINT_TEMPLATE_MAP.leave_home,
  CHECKPOINT_TEMPLATE_MAP.study_start,
  CHECKPOINT_TEMPLATE_MAP.workout,
] as const;

export function normalizeUseCaseType(value: unknown): UseCaseType {
  return typeof value === 'string' && VALID_USE_CASE_TYPES.has(value as UseCaseType)
    ? (value as UseCaseType)
    : DEFAULT_USE_CASE_TYPE;
}

export function getCheckpointTemplate(value: unknown) {
  return CHECKPOINT_TEMPLATE_MAP[normalizeUseCaseType(value)];
}

export function getUseCaseLabel(value: unknown) {
  return getCheckpointTemplate(value).title;
}

export function getUseCaseShortLabel(value: unknown) {
  return getCheckpointTemplate(value).shortTitle;
}

export function getCheckpointTemplateDefaults(value: unknown) {
  const template = getCheckpointTemplate(value);

  return {
    useCaseType: template.id,
    label: template.defaultLabel,
    repeatSchedule: template.repeatSchedule,
    gracePeriodSeconds: template.gracePeriodSeconds,
  };
}

export function formatGracePeriodLabel(gracePeriodSeconds: number) {
  if (gracePeriodSeconds < 60) {
    return `${gracePeriodSeconds}s`;
  }

  if (gracePeriodSeconds % 60 === 0) {
    const minutes = gracePeriodSeconds / 60;
    return `${minutes} min`;
  }

  return `${Math.floor(gracePeriodSeconds / 60)}m ${gracePeriodSeconds % 60}s`;
}

function getCheckpointTargetLabel(label: string) {
  const trimmedLabel = label.trim();
  return trimmedLabel.length > 0 ? trimmedLabel : 'saved checkpoint';
}

export function getCheckpointLiveCopy(value: unknown, label: string): CheckpointLiveCopy {
  const useCaseType = normalizeUseCaseType(value);
  const targetLabel = getCheckpointTargetLabel(label);

  switch (useCaseType) {
    case 'wake_up':
      return {
        title: 'Get up and scan',
        description: `Stand up, get all the way to ${targetLabel}, and scan the saved QR code.`,
        warningDescription: `Move now. Reach ${targetLabel} and scan the saved code before this wake-up run expires.`,
        criticalDescription: `Final call. Reach ${targetLabel} and scan now or this wake-up run will count as missed.`,
        focusBody: 'Only the exact QR saved for this checkpoint clears the run.',
        permissionTitle: 'Camera access is required to clear this wake-up run',
        permissionDescription: `Allow camera access so you can scan ${targetLabel} and prove you are out of bed.`,
        wrongCodeTitle: 'Wrong wake-up checkpoint',
        wrongCodeDescription: `That QR does not match ${targetLabel}. Go to the saved checkpoint and scan that exact code.`,
      };
    case 'medication':
      return {
        title: 'Take it and scan',
        description: `Go to ${targetLabel}, take the medication, and scan the saved QR code.`,
        warningDescription: `Move now. Take the medication, reach ${targetLabel}, and scan before time runs out.`,
        criticalDescription: `Final call. Get to ${targetLabel} and scan now so this medication run does not lock in as missed.`,
        focusBody: 'Clear the run only with the QR saved where the medication actually lives.',
        permissionTitle: 'Camera access is required to confirm this medication run',
        permissionDescription: `Allow camera access so you can scan ${targetLabel} and confirm the dose on time.`,
        wrongCodeTitle: 'Wrong medication checkpoint',
        wrongCodeDescription: `That QR is not the one saved for ${targetLabel}. Scan the exact code at the medication checkpoint.`,
      };
    case 'study_start':
      return {
        title: 'Start studying and scan',
        description: `Get to ${targetLabel}, begin the study session for real, and scan the saved QR code.`,
        warningDescription: `Move now. Reach ${targetLabel}, start the session, and scan before this study run expires.`,
        criticalDescription: `Final call. Get to ${targetLabel} and scan now or this study-start run will count as missed.`,
        focusBody: 'Use the QR saved at your real study setup so the start is hard to fake.',
        permissionTitle: 'Camera access is required to clear this study run',
        permissionDescription: `Allow camera access so you can scan ${targetLabel} once you are actually in position to study.`,
        wrongCodeTitle: 'Wrong study checkpoint',
        wrongCodeDescription: `That QR does not match ${targetLabel}. Use the saved code at your study setup.`,
      };
    case 'deep_work':
      return {
        title: 'Start the block and scan',
        description: `Get to ${targetLabel}, begin the deep-work block, and scan the saved QR code.`,
        warningDescription: `Move now. Reach ${targetLabel} and scan before this focus block slips.`,
        criticalDescription: `Final call. Get to ${targetLabel} and scan now or this deep-work start will count as missed.`,
        focusBody: 'Only the QR saved at the real workstation clears this start-of-focus checkpoint.',
        permissionTitle: 'Camera access is required to clear this focus run',
        permissionDescription: `Allow camera access so you can scan ${targetLabel} once the deep-work block has actually started.`,
        wrongCodeTitle: 'Wrong deep-work checkpoint',
        wrongCodeDescription: `That QR does not match ${targetLabel}. Scan the saved code at the real focus setup.`,
      };
    case 'leave_home':
      return {
        title: 'Leave now and scan',
        description: `Get to ${targetLabel}, start leaving, and scan the saved QR code.`,
        warningDescription: `Move now. Reach ${targetLabel} and scan before this leave-on-time run expires.`,
        criticalDescription: `Final call. Get to ${targetLabel} and scan now or this leave-on-time run will count as missed.`,
        focusBody: 'Only the QR saved at the exit point clears this run.',
        permissionTitle: 'Camera access is required to confirm this departure',
        permissionDescription: `Allow camera access so you can scan ${targetLabel} when you are actually leaving.`,
        wrongCodeTitle: 'Wrong leave-on-time checkpoint',
        wrongCodeDescription: `That QR is not the one saved for ${targetLabel}. Use the code at the exit checkpoint.`,
      };
    case 'workout':
      return {
        title: 'Start moving and scan',
        description: `Get to ${targetLabel}, begin the workout, and scan the saved QR code.`,
        warningDescription: `Move now. Reach ${targetLabel}, start moving, and scan before this workout run expires.`,
        criticalDescription: `Final call. Get to ${targetLabel} and scan now or this workout start will count as missed.`,
        focusBody: 'Use the QR saved at the bag, mat, or entry point that proves the workout actually started.',
        permissionTitle: 'Camera access is required to clear this workout run',
        permissionDescription: `Allow camera access so you can scan ${targetLabel} once you are really starting the workout.`,
        wrongCodeTitle: 'Wrong workout checkpoint',
        wrongCodeDescription: `That QR does not match ${targetLabel}. Scan the saved code at the real workout checkpoint.`,
      };
    default:
      return {
        title: 'Reach the checkpoint and scan',
        description: `Get to ${targetLabel} and scan the saved QR code before time runs out.`,
        warningDescription: `Move now. Reach ${targetLabel} and scan the saved code before this run expires.`,
        criticalDescription: `Final call. Get to ${targetLabel} and scan now or this run will count as missed.`,
        focusBody: 'Only the exact QR saved for this checkpoint clears the run.',
        permissionTitle: 'Camera access is required to clear this checkpoint',
        permissionDescription: `Allow camera access so you can scan ${targetLabel} and clear the live checkpoint.`,
        wrongCodeTitle: 'Wrong checkpoint',
        wrongCodeDescription: `That QR does not match ${targetLabel}. Go to the saved checkpoint and scan that exact code.`,
      };
  }
}

export function getCheckpointNotificationCopy(
  value: unknown,
  label: string,
  gracePeriodSeconds: number,
  secondsRemaining?: number
) {
  const useCaseType = normalizeUseCaseType(value);
  const targetLabel = getCheckpointTargetLabel(label);
  const windowLabel =
    typeof secondsRemaining === 'number' ? formatGracePeriodLabel(secondsRemaining) : formatGracePeriodLabel(gracePeriodSeconds);

  switch (useCaseType) {
    case 'wake_up':
      return typeof secondsRemaining === 'number'
        ? {
            title: `${windowLabel} left: wake-up proof`,
            body: `Open the app, get to ${targetLabel}, and scan now.`,
          }
        : {
            title: 'Wake-up checkpoint live',
            body: `Open the app, stand up, get to ${targetLabel}, and scan within ${windowLabel}.`,
          };
    case 'medication':
      return typeof secondsRemaining === 'number'
        ? {
            title: `${windowLabel} left: medication proof`,
            body: `Get to ${targetLabel}, take it, and scan now.`,
          }
        : {
            title: 'Medication checkpoint live',
            body: `Go to ${targetLabel}, take the medication, and scan within ${windowLabel}.`,
          };
    case 'study_start':
      return typeof secondsRemaining === 'number'
        ? {
            title: `${windowLabel} left: study start`,
            body: `Get to ${targetLabel} and scan now so this session starts for real.`,
          }
        : {
            title: 'Study checkpoint live',
            body: `Get to ${targetLabel}, start the session, and scan within ${windowLabel}.`,
          };
    case 'deep_work':
      return typeof secondsRemaining === 'number'
        ? {
            title: `${windowLabel} left: deep-work start`,
            body: `Reach ${targetLabel} and scan now so the block starts on time.`,
          }
        : {
            title: 'Deep-work checkpoint live',
            body: `Get to ${targetLabel}, start the block, and scan within ${windowLabel}.`,
          };
    case 'leave_home':
      return typeof secondsRemaining === 'number'
        ? {
            title: `${windowLabel} left: leave now`,
            body: `Reach ${targetLabel} and scan now so this departure does not count as missed.`,
          }
        : {
            title: 'Leave-on-time checkpoint live',
            body: `Get to ${targetLabel}, start leaving, and scan within ${windowLabel}.`,
          };
    case 'workout':
      return typeof secondsRemaining === 'number'
        ? {
            title: `${windowLabel} left: workout start`,
            body: `Reach ${targetLabel}, start moving, and scan now.`,
          }
        : {
            title: 'Workout checkpoint live',
            body: `Get to ${targetLabel}, begin the workout, and scan within ${windowLabel}.`,
          };
    default:
      return typeof secondsRemaining === 'number'
        ? {
            title: `${windowLabel} left: checkpoint`,
            body: `Reach ${targetLabel} and scan the saved QR code now.`,
          }
        : {
            title: 'Checkpoint live',
            body: `Get to ${targetLabel} and scan within ${windowLabel}.`,
          };
  }
}

export function getCheckpointReadinessNotificationCopy(value: unknown, label: string) {
  const targetLabel = getCheckpointTargetLabel(label);

  switch (normalizeUseCaseType(value)) {
    case 'wake_up':
      return {
        title: 'Set up tomorrow’s wake-up',
        body: `Keep ${targetLabel} ready tonight so the wake-up proof is clean in the morning.`,
      };
    case 'medication':
      return {
        title: 'Prep the medication checkpoint',
        body: `Make sure ${targetLabel} is ready so tomorrow’s medication checkpoint is frictionless.`,
      };
    case 'study_start':
      return {
        title: 'Prep tomorrow’s study start',
        body: `Set up ${targetLabel} tonight so getting into study mode is easier tomorrow.`,
      };
    case 'deep_work':
      return {
        title: 'Prep tomorrow’s focus block',
        body: `Reset ${targetLabel} tonight so the deep-work checkpoint starts clean tomorrow.`,
      };
    case 'leave_home':
      return {
        title: 'Get tomorrow’s exit ready',
        body: `Set up ${targetLabel} tonight so leaving on time takes less friction tomorrow.`,
      };
    case 'workout':
      return {
        title: 'Prep tomorrow’s workout start',
        body: `Get ${targetLabel} ready tonight so the workout checkpoint is easier to clear tomorrow.`,
      };
    default:
      return {
        title: 'Prep tomorrow’s checkpoint',
        body: `Get ${targetLabel} ready tonight so tomorrow’s checkpoint starts clean.`,
      };
  }
}

export function getWeeklyReviewNotificationCopy() {
  return {
    title: 'Weekly review ready',
    body: 'Open the app to see what held, what slipped, and which routine needs attention next.',
  };
}

export function getCheckpointRoutineCopy(value: unknown) {
  switch (normalizeUseCaseType(value)) {
    case 'wake_up':
      return 'wake-up routine';
    case 'medication':
      return 'medication routine';
    case 'study_start':
      return 'study routine';
    case 'deep_work':
      return 'deep-work routine';
    case 'leave_home':
      return 'leave-on-time routine';
    case 'workout':
      return 'workout routine';
    default:
      return 'routine';
  }
}
