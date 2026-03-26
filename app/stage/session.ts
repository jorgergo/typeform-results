export type StageRankingEntry = {
  rank: number;
  participant: string;
  company: string;
  totalScore: number;
  completionTimeMs?: number | null;
  questionScores: Record<string, number>;
};

export type StageSessionPayload = {
  ranking: StageRankingEntry[];
  selectedQuestions: string[];
  fileName: string;
  generatedAt: string;
  title: string;
};

const STORAGE_PREFIX = "kickoff-stage-session:";
const LAST_SESSION_KEY = "kickoff-stage-last";
const MAX_SESSIONS = 8;

function isStageSessionPayload(value: unknown): value is StageSessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<StageSessionPayload>;
  return (
    Array.isArray(candidate.ranking) &&
    Array.isArray(candidate.selectedQuestions) &&
    typeof candidate.fileName === "string" &&
    typeof candidate.generatedAt === "string" &&
    typeof candidate.title === "string"
  );
}

function trimOldSessions() {
  if (typeof window === "undefined") {
    return;
  }

  const keys = Object.keys(window.localStorage).filter((key) => key.startsWith(STORAGE_PREFIX));

  if (keys.length <= MAX_SESSIONS) {
    return;
  }

  const sorted = keys
    .map((key) => {
      const raw = window.localStorage.getItem(key);
      if (!raw) {
        return { key, generatedAt: 0 };
      }

      try {
        const parsed = JSON.parse(raw) as Partial<StageSessionPayload>;
        return {
          key,
          generatedAt: parsed.generatedAt ? Date.parse(parsed.generatedAt) : 0,
        };
      } catch {
        return { key, generatedAt: 0 };
      }
    })
    .sort((a, b) => b.generatedAt - a.generatedAt);

  sorted.slice(MAX_SESSIONS).forEach(({ key }) => {
    window.localStorage.removeItem(key);
  });
}

export function saveStageSession(payload: StageSessionPayload) {
  if (typeof window === "undefined") {
    return null;
  }

  const sessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const storageKey = `${STORAGE_PREFIX}${sessionId}`;

  window.localStorage.setItem(storageKey, JSON.stringify(payload));
  window.localStorage.setItem(LAST_SESSION_KEY, sessionId);
  trimOldSessions();

  return sessionId;
}

export function readStageSession(sessionId?: string | null) {
  if (typeof window === "undefined") {
    return null;
  }

  const idToLoad = sessionId || window.localStorage.getItem(LAST_SESSION_KEY);
  if (!idToLoad) {
    return null;
  }

  const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${idToLoad}`);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isStageSessionPayload(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}
