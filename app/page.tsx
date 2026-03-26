"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Papa from "papaparse";
import {
  Calculator,
  Eraser,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Grid3X3,
  ListChecks,
  Presentation,
  Sparkles,
  Table2,
  Trophy,
  Upload,
  Users,
  WandSparkles,
} from "lucide-react";
import { saveStageSession } from "./stage/session";

type CsvRow = Record<string, string>;

type RankingEntry = {
  rank: number;
  participant: string;
  company: string;
  totalScore: number;
  completionTimeMs: number | null;
  questionScores: Record<string, number>;
};

type ResultsView = "spotlight" | "cards" | "table";

const NON_QUESTION_COLUMNS = new Set(
  [
    "#",
    "first name",
    "last name",
    "company",
    "correct_answers",
    "max_score",
    "quiz_score",
    "total_scorable_questions",
    "response type",
    "start date utc",
    "stage date utc",
    "submit date utc",
    "network id",
    "tags",
    "ending",
  ].map(normalizeKey),
);

const DEFAULT_ANSWER_PATTERNS: Array<{ pattern: string; answer: string }> = [
  {
    pattern:
      "cual es el nombre del sitio de panduit que permite al integrador descargar contenido digital para sus redes sociales",
    answer: "CREM (Creative Resources Matrix)",
  },
  {
    pattern: "cual es el principal beneficio del cable y conectividad de cobre sobre la fo",
    answer: "Transmisión de datos y potencia",
  },
  { pattern: "fmps clase 4 puede entregar hasta 600w por par de cobre", answer: "Verdadero" },
  {
    pattern:
      "los ups y conectividad de fibra optica standard no tienen aplicacion en un data center on premise y colocation",
    answer: "Falso",
  },
  {
    pattern: "cual fue el primer producto de panduit y del cual viene nuestro nombre",
    answer: "Ducto ranurado",
  },
];

const ALLOWED_QUESTION_PATTERNS = new Set(DEFAULT_ANSWER_PATTERNS.map(({ pattern }) => pattern));

const percentFormatter = new Intl.NumberFormat("es-MX", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const SPOTLIGHT_LIMIT = 10;
const COMPACT_BATCH_SIZE = 36;
const SCORE_TIE_EPSILON = 0.0001;

const subscribeToNoopStore = () => () => {};

function normalizeKey(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function parseNumber(value: string) {
  if (!value) {
    return null;
  }

  const cleaned = value.replace(/\s/g, "");
  const match = cleaned.match(/-?\d+(?:[.,]\d+)?/);
  if (!match) {
    return null;
  }

  const normalized = match[0].replace(",", ".");
  const parsed = Number.parseFloat(normalized);

  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function parseUtcTimestamp(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (parts) {
    const [, year, month, day, hour, minute, second = "0"] = parts;
    const timestamp = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
    );

    return Number.isFinite(timestamp) ? timestamp : null;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function similarity(a: string, b: string) {
  if (!a && !b) {
    return 1;
  }

  if (a === b) {
    return 1;
  }

  const distance = levenshtein(a, b);
  const maxLength = Math.max(a.length, b.length, 1);
  return Math.max(0, 1 - distance / maxLength);
}

function levenshtein(a: string, b: string) {
  const rows = b.length + 1;
  const cols = a.length + 1;
  const matrix = Array.from({ length: rows }, () => Array<number>(cols).fill(0));

  for (let i = 0; i < cols; i += 1) {
    matrix[0][i] = i;
  }

  for (let j = 0; j < rows; j += 1) {
    matrix[j][0] = j;
  }

  for (let j = 1; j < rows; j += 1) {
    for (let i = 1; i < cols; i += 1) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;

      matrix[j][i] = Math.min(
        matrix[j - 1][i] + 1,
        matrix[j][i - 1] + 1,
        matrix[j - 1][i - 1] + substitutionCost,
      );
    }
  }

  return matrix[rows - 1][cols - 1];
}

function getDetectedQuestions(headers: string[]) {
  return headers.filter((header) => {
    const normalizedHeader = normalizeKey(header);

    if (NON_QUESTION_COLUMNS.has(normalizedHeader)) {
      return false;
    }

    return [...ALLOWED_QUESTION_PATTERNS].some((pattern) => normalizedHeader.includes(pattern));
  });
}

function getPrefilledAnswerKey(questions: string[]) {
  return Object.fromEntries(
    questions.map((question) => {
      const normalizedQuestion = normalizeKey(question);
      const matchedPattern = DEFAULT_ANSWER_PATTERNS.find(({ pattern }) =>
        normalizedQuestion.includes(pattern),
      );
      return [question, matchedPattern?.answer ?? ""];
    }),
  ) as Record<string, string>;
}

function valueByNormalizedHeader(row: CsvRow, normalizedHeader: string) {
  const entry = Object.entries(row).find(([header]) => normalizeKey(header) === normalizedHeader);
  return entry?.[1]?.trim() ?? "";
}

function getCompletionTimeMs(row: CsvRow) {
  const startValue = valueByNormalizedHeader(row, "start date utc") || valueByNormalizedHeader(row, "start date");
  const submitValue = valueByNormalizedHeader(row, "submit date utc") || valueByNormalizedHeader(row, "submit date");

  const startTimestamp = parseUtcTimestamp(startValue);
  const submitTimestamp = parseUtcTimestamp(submitValue);

  if (startTimestamp === null || submitTimestamp === null) {
    return null;
  }

  const completionTimeMs = submitTimestamp - startTimestamp;
  if (!Number.isFinite(completionTimeMs) || completionTimeMs < 0) {
    return null;
  }

  return completionTimeMs;
}

function formatCompletionTime(durationMs?: number | null) {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs)) {
    return "N/D";
  }

  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function toParticipantName(row: CsvRow) {
  const firstName = valueByNormalizedHeader(row, "first name");
  const lastName = valueByNormalizedHeader(row, "last name");
  const fullName = `${firstName} ${lastName}`.trim();

  if (fullName) {
    return fullName;
  }

  return valueByNormalizedHeader(row, "#") || "Participante sin nombre";
}

function computeQuestionScale(rows: CsvRow[], question: string, expectedAnswer: string) {
  const target = parseNumber(expectedAnswer);
  if (target === null) {
    return null;
  }

  const observed = rows
    .map((row) => parseNumber((row[question] ?? "").toString()))
    .filter((value): value is number => value !== null);

  const min = observed.length > 0 ? Math.min(...observed) : target;
  const max = observed.length > 0 ? Math.max(...observed) : target;
  const range = Math.abs(max - min);

  return {
    target,
    scale: Math.max(1, Math.abs(target), range),
  };
}

function scoreResponses(
  rows: CsvRow[],
  selectedQuestions: string[],
  answerKey: Record<string, string>,
) {
  const scales: Record<string, ReturnType<typeof computeQuestionScale>> = {};

  selectedQuestions.forEach((question) => {
    scales[question] = computeQuestionScale(rows, question, answerKey[question] ?? "");
  });

  const ranking = rows.map((row, sourceOrder) => {
    const questionScores: Record<string, number> = {};
    let scoreSum = 0;

    selectedQuestions.forEach((question) => {
      const expected = answerKey[question] ?? "";
      const currentValue = (row[question] ?? "").toString();
      const numericScale = scales[question];

      let score = 0;

      if (numericScale) {
        const participantNumber = parseNumber(currentValue);
        if (participantNumber !== null) {
          const delta = Math.abs(participantNumber - numericScale.target);
          score = Math.max(0, 1 - delta / numericScale.scale);
        }
      } else {
        score = similarity(normalizeText(currentValue), normalizeText(expected));
      }

      questionScores[question] = score;
      scoreSum += score;
    });

    return {
      participant: toParticipantName(row),
      company: valueByNormalizedHeader(row, "company") || "Sin empresa",
      totalScore: selectedQuestions.length > 0 ? (scoreSum / selectedQuestions.length) * 100 : 0,
      questionScores,
      completionTimeMs: getCompletionTimeMs(row),
      sourceOrder,
    };
  });

  return ranking
    .sort((a, b) => {
      const scoreDelta = b.totalScore - a.totalScore;
      if (Math.abs(scoreDelta) > SCORE_TIE_EPSILON) {
        return scoreDelta;
      }

      const aCompletionTime = a.completionTimeMs;
      const bCompletionTime = b.completionTimeMs;

      if (aCompletionTime !== null && bCompletionTime !== null && aCompletionTime !== bCompletionTime) {
        return aCompletionTime - bCompletionTime;
      }

      if (aCompletionTime !== null && bCompletionTime === null) {
        return -1;
      }

      if (aCompletionTime === null && bCompletionTime !== null) {
        return 1;
      }

      return a.sourceOrder - b.sourceOrder;
    })
    .map((entry, index) => ({
      participant: entry.participant,
      company: entry.company,
      totalScore: entry.totalScore,
      completionTimeMs: entry.completionTimeMs,
      questionScores: entry.questionScores,
      rank: index + 1,
    }));
}

function getDefaultResultsView(totalParticipants: number): ResultsView {
  if (totalParticipants >= 200) {
    return "spotlight";
  }

  if (totalParticipants > 40) {
    return "cards";
  }

  return "table";
}

function escapeCsvValue(value: string | number) {
  const text = String(value);
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function createRankingCsv(ranking: RankingEntry[], selectedQuestions: string[]) {
  const headers = [
    "rank",
    "participant",
    "company",
    "total_score_pct",
    ...selectedQuestions.map((question, index) => `q${index + 1}_score_pct:${question}`),
  ];

  const lines = [headers.map(escapeCsvValue).join(",")];

  ranking.forEach((entry) => {
    const row = [
      entry.rank,
      entry.participant,
      entry.company,
      entry.totalScore.toFixed(1),
      ...selectedQuestions.map((question) => (entry.questionScores[question] * 100).toFixed(0)),
    ];
    lines.push(row.map(escapeCsvValue).join(","));
  });

  return lines.join("\n");
}

export default function Home() {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [questions, setQuestions] = useState<string[]>([]);
  const [answerKey, setAnswerKey] = useState<Record<string, string>>({});
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [resultsView, setResultsView] = useState<ResultsView>("spotlight");
  const [showRankingPreview, setShowRankingPreview] = useState(false);
  const [visibleRankingCount, setVisibleRankingCount] = useState(COMPACT_BATCH_SIZE);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Sube un archivo CSV para comenzar.");
  const [error, setError] = useState("");
  const dragDepth = useRef(0);

  const hasHydrated = useSyncExternalStore(subscribeToNoopStore, () => true, () => false);
  const readyToAnalyze = rows.length > 0 && questions.length > 0;
  const answerActionsDisabled = questions.length === 0;
  const hasResults = ranking.length > 0;
  const canUseCardsView = ranking.length > SPOTLIGHT_LIMIT;
  const canLoadMoreCards = visibleRankingCount < ranking.length;
  const compactRanking = useMemo(
    () => ranking.slice(0, visibleRankingCount),
    [ranking, visibleRankingCount],
  );

  const completion = useMemo(() => {
    if (questions.length === 0) {
      return 0;
    }

    const completed = questions.filter((question) => (answerKey[question] ?? "").trim()).length;
    return Math.round((completed / questions.length) * 100);
  }, [answerKey, questions]);

  const resetRankingPresentation = () => {
    setRanking([]);
    setResultsView("spotlight");
    setShowRankingPreview(false);
    setVisibleRankingCount(COMPACT_BATCH_SIZE);
  };

  const exportRankingCsv = useCallback(() => {
    if (ranking.length === 0) {
      return;
    }

    const csvContent = createRankingCsv(ranking, questions);
    const sourceName = fileName ? fileName.replace(/\.csv$/i, "") : "ranking";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const downloadName = `${sourceName}-ranking-${timestamp}.csv`;
    const csvWithBom = `\uFEFF${csvContent}`;
    const blob = new Blob([csvWithBom], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = downloadName;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatusMessage(`CSV exportado: ${downloadName}`);
  }, [fileName, questions, ranking]);

  const openStageExperience = useCallback(() => {
    if (ranking.length === 0) {
      return;
    }

    const sessionId = saveStageSession({
      ranking,
      selectedQuestions: questions,
      fileName,
      generatedAt: new Date().toISOString(),
      title: "Kick Off Integradores 2026",
    });

    if (!sessionId) {
      setError("No pudimos abrir la vista de escenario.");
      return;
    }

    const stageUrl = `/stage?session=${encodeURIComponent(sessionId)}`;
    const popup = window.open(stageUrl, "_blank", "noopener,noreferrer");

    if (!popup) {
      window.location.assign(stageUrl);
      return;
    }

    setStatusMessage("Vista de escenario abierta en una nueva pestaña.");
  }, [fileName, questions, ranking]);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const isEditableElement =
          target.isContentEditable ||
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT";

        if (isEditableElement) {
          return;
        }
      }

      const key = event.key.toLowerCase();

      if (!hasResults) {
        return;
      }

      if (key === "1" || key === "s") {
        if (!showRankingPreview) {
          return;
        }
        event.preventDefault();
        setResultsView("spotlight");
        return;
      }

      if ((key === "2" || key === "c") && canUseCardsView) {
        if (!showRankingPreview) {
          return;
        }
        event.preventDefault();
        setResultsView("cards");
        return;
      }

      if (key === "3" || key === "t") {
        if (!showRankingPreview) {
          return;
        }
        event.preventDefault();
        setResultsView("table");
        return;
      }

      if (key === "r") {
        event.preventDefault();
        setShowRankingPreview((current) => !current);
      }

      if (key === "e") {
        event.preventDefault();
        exportRankingCsv();
        return;
      }

      if (key === "v") {
        event.preventDefault();
        openStageExperience();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => {
      window.removeEventListener("keydown", handleKeydown);
    };
  }, [canUseCardsView, exportRankingCsv, hasResults, openStageExperience, showRankingPreview]);

  const processCsvFile = (selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      setError("Solo se permiten archivos CSV de respuestas.");
      setStatusMessage("Archivo invalido. Sube un CSV para continuar.");
      return;
    }

    setError("");
    resetRankingPresentation();
    setFileName(selectedFile.name);
    setStatusMessage("Leyendo archivo…");

    Papa.parse<CsvRow>(selectedFile, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (results) => {
        const parsedHeaders = results.meta.fields ?? [];
        const parsedRows = results.data.filter((row) =>
          Object.values(row).some((value) => (value ?? "").toString().trim().length > 0),
        );

        if (parsedHeaders.length === 0 || parsedRows.length === 0) {
          setError("No pudimos detectar filas o columnas de respuestas en el CSV.");
          setRows([]);
          setQuestions([]);
          setAnswerKey({});
          resetRankingPresentation();
          setStatusMessage("No se encontraron respuestas validas.");
          return;
        }

        const detectedQuestions = getDetectedQuestions(parsedHeaders);

        if (detectedQuestions.length === 0) {
          setRows(parsedRows);
          setQuestions([]);
          setAnswerKey({});
          setError("El CSV no incluye ninguna de las preguntas permitidas para este ranking.");
          resetRankingPresentation();
          setStatusMessage("No se detectaron preguntas habilitadas en el archivo cargado.");
          return;
        }

        setRows(parsedRows);
        setQuestions(detectedQuestions);
        setAnswerKey(getPrefilledAnswerKey(detectedQuestions));
        setStatusMessage(
          `Archivo cargado: ${parsedRows.length} respuestas y ${detectedQuestions.length} preguntas detectadas. Puedes editar las respuestas sugeridas.`,
        );
      },
      error: () => {
        setError("No pudimos leer el archivo. Verifica que sea un CSV valido.");
        setStatusMessage("Error al procesar el archivo.");
      },
    });
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) {
      return;
    }

    processCsvFile(selectedFile);
  };

  const handleDragEnter = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current += 1;
    setIsDragging(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) {
      setIsDragging(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepth.current = 0;
    setIsDragging(false);

    const droppedFile = event.dataTransfer.files?.[0];
    if (!droppedFile) {
      return;
    }

    processCsvFile(droppedFile);
  };

  const updateAnswer = (question: string, value: string) => {
    setAnswerKey((current) => ({
      ...current,
      [question]: value,
    }));
    resetRankingPresentation();
  };

  const applySuggestedAnswers = () => {
    if (questions.length === 0) {
      return;
    }

    setAnswerKey(getPrefilledAnswerKey(questions));
    resetRankingPresentation();
    setError("");
    setStatusMessage("Respuestas sugeridas aplicadas. Puedes editarlas antes de generar el ranking.");
  };

  const clearAllAnswers = () => {
    if (questions.length === 0) {
      return;
    }

    setAnswerKey(Object.fromEntries(questions.map((question) => [question, ""])));
    resetRankingPresentation();
    setStatusMessage("Respuestas limpiadas. Completa los campos para analizar.");
  };

  const runRanking = () => {
    if (isAnalyzing) {
      return;
    }

    if (!readyToAnalyze) {
      setError("Sube un CSV con preguntas detectadas para generar el ranking.");
      return;
    }

    const missingAnswers = questions.filter((question) => !(answerKey[question] ?? "").toString().trim());

    if (missingAnswers.length > 0) {
      setError("Completa todas las respuestas esperadas antes de generar el ranking.");
      return;
    }

    setIsAnalyzing(true);
    setError("");
    window.requestAnimationFrame(() => {
      const results = scoreResponses(rows, questions, answerKey);
      setRanking(results);
      setResultsView(getDefaultResultsView(results.length));
      setShowRankingPreview(false);
      setVisibleRankingCount(Math.min(COMPACT_BATCH_SIZE, results.length));
      setStatusMessage(`Ranking generado para ${results.length} participantes.`);
      setIsAnalyzing(false);
    });
  };

  return (
    <div className="page-shell">
      <a className="skip-link" href="#main-content">
        Saltar al contenido
      </a>
      <main className="page-content" id="main-content">
        <section className="hero reveal reveal-1">
          <p className="eyebrow">Ranking en vivo</p>
          <h1>Panel de resultados para Kick Off Integradores 2026</h1>
          <p>
            Sube un CSV de respuestas y define los valores esperados para cada pregunta. El ranking
            premia las respuestas mas cercanas, tanto numericas como de texto.
          </p>
        </section>

        <section className="panel-grid reveal reveal-2">
          <article className="panel upload-panel stage-panel">
            <h2 className="section-title-with-icon">
              <Upload aria-hidden="true" size={18} strokeWidth={2.3} className="section-title-icon" />
              <span>1. Cargar Archivo</span>
            </h2>
            <p>Importa el CSV de respuestas para detectar preguntas automaticamente.</p>
            <label
              className={`upload-input${isDragging ? " is-dragging" : ""}`}
              htmlFor="csv-input"
              onDragEnter={handleDragEnter}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <input
                id="csv-input"
                name="responsesCsv"
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileUpload}
                aria-describedby="upload-help"
              />
              <span>
                {fileName
                  ? `Archivo: ${fileName}`
                  : isDragging
                    ? "Suelta tu archivo CSV aqui"
                    : "Seleccionar archivo CSV o arrastrarlo aqui"}
              </span>
            </label>
            <small id="upload-help">
              El analisis ignora metadatos del formulario y cualquier pregunta fuera del bloque
              habilitado para este ranking.
            </small>
          </article>

          <article className="panel answer-panel stage-panel">
            <div className="panel-header">
              <h2 className="section-title-with-icon">
                <ListChecks aria-hidden="true" size={18} strokeWidth={2.3} className="section-title-icon" />
                <span>2. Definir Respuestas</span>
              </h2>
              <span>{completion}% completo</span>
            </div>
            <div className="answer-actions">
              <button
                type="button"
                className="secondary-button secondary-button-with-icon"
                onClick={applySuggestedAnswers}
                aria-disabled={answerActionsDisabled}
                disabled={hasHydrated ? answerActionsDisabled : undefined}
              >
                <WandSparkles aria-hidden="true" size={15} strokeWidth={2.2} />
                <span>Usar Sugeridas</span>
              </button>
              <button
                type="button"
                className="secondary-button secondary-button-muted secondary-button-with-icon"
                onClick={clearAllAnswers}
                aria-disabled={answerActionsDisabled}
                disabled={hasHydrated ? answerActionsDisabled : undefined}
              >
                <Eraser aria-hidden="true" size={15} strokeWidth={2.2} />
                <span>Limpiar Todo</span>
              </button>
            </div>
            {questions.length === 0 ? (
              <p className="empty-message">Carga un CSV para detectar preguntas automaticamente.</p>
            ) : (
              <div className="question-list">
                {questions.map((question, index) => {
                  const inputId = `answer-${index}`;

                  return (
                    <div className="question-item" key={question}>
                      <label className="question-toggle" htmlFor={inputId}>
                        <span className="question-text">{question}</span>
                      </label>
                      <label className="sr-only" htmlFor={inputId}>
                        Respuesta esperada para la pregunta {index + 1}
                      </label>
                      <input
                        id={inputId}
                        name={`expectedAnswer${index + 1}`}
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        value={answerKey[question] ?? ""}
                        onChange={(event) => updateAnswer(question, event.target.value)}
                        placeholder="Escribe la respuesta esperada…"
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </article>
        </section>

        <section className="action-row reveal reveal-3">
          <button
            type="button"
            onClick={runRanking}
            aria-disabled={!readyToAnalyze || isAnalyzing}
            className="primary-button primary-button-with-icon"
          >
            <Calculator aria-hidden="true" size={18} strokeWidth={2.4} />
            <span>{isAnalyzing ? "Calculando…" : "Generar Ranking"}</span>
          </button>
          <p>
            Para preguntas numericas, el score se calcula por distancia relativa al valor esperado.
            Para texto, usamos similitud de cadenas. Si hay empate de score final, gana quien
            completo el quiz en menos tiempo (Submit Date - Start Date).
          </p>
        </section>

        <p className="status-box reveal reveal-4" aria-live="polite">
          {statusMessage}
        </p>

        {error ? (
          <p className="error-box" aria-live="polite">
            {error}
          </p>
        ) : null}

        {hasResults ? (
          <section className="results-panel reveal reveal-5" aria-labelledby="results-heading">
            <div className="results-ambient" aria-hidden="true" />
            <div className="results-header">
              <h2 id="results-heading">
                <Trophy aria-hidden="true" size={20} strokeWidth={2.25} />
                <span>Ranking Final</span>
              </h2>
              <p>{ranking.length} participantes evaluados</p>
            </div>

            <div className="results-toolbar presentation-toolbar" aria-label="Acciones de presentacion">
              <div className="results-toolbar-group">
                <button type="button" className="results-tab results-tab-stage" onClick={openStageExperience}>
                  <Presentation aria-hidden="true" size={16} strokeWidth={2.3} className="results-tab-icon" />
                  <span>Lanzar escenario</span>
                </button>
                <button type="button" className="results-tab results-tab-with-icon" onClick={exportRankingCsv}>
                  <FileSpreadsheet aria-hidden="true" size={15} strokeWidth={2.3} className="results-tab-icon" />
                  <span>Exportar CSV</span>
                </button>
              </div>
              <div className="results-toolbar-group">
                <button
                  type="button"
                  className={`results-tab results-tab-with-icon${showRankingPreview ? " is-active" : ""}`}
                  onClick={() => setShowRankingPreview((current) => !current)}
                  aria-pressed={showRankingPreview}
                >
                  {showRankingPreview ? (
                    <EyeOff aria-hidden="true" size={15} strokeWidth={2.3} className="results-tab-icon" />
                  ) : (
                    <Eye aria-hidden="true" size={15} strokeWidth={2.3} className="results-tab-icon" />
                  )}
                  <span>{showRankingPreview ? "Ocultar ranking local" : "Mostrar ranking aqui"}</span>
                </button>
              </div>
            </div>

            {!showRankingPreview ? (
              <section className="stage-launch-brief" aria-label="Modo presentacion sin spoilers">
                <p className="stage-launch-kicker">Modo presentacion</p>
                <h3>Resultados listos para anunciar en escenario</h3>
                <p>
                  Mantuvimos esta pantalla sin spoilers para no revelar ganadores antes del show.
                  Usa Lanzar escenario para la presentacion en vivo o Exportar CSV para respaldo.
                </p>
                <div className="stage-launch-metrics" aria-label="Resumen del analisis">
                  <article>
                    <span className="stage-launch-metric-label">
                      <Users aria-hidden="true" size={14} strokeWidth={2.35} />
                      <span>Participantes</span>
                    </span>
                    <strong>{ranking.length}</strong>
                  </article>
                  <article>
                    <span className="stage-launch-metric-label">
                      <ListChecks aria-hidden="true" size={14} strokeWidth={2.35} />
                      <span>Preguntas evaluadas</span>
                    </span>
                    <strong>{questions.length}</strong>
                  </article>
                  <article>
                    <span className="stage-launch-metric-label">
                      <Trophy aria-hidden="true" size={14} strokeWidth={2.35} />
                      <span>Puntaje maximo</span>
                    </span>
                    <strong>{percentFormatter.format(ranking[0]?.totalScore ?? 0)} pts</strong>
                  </article>
                  <article>
                    <span className="stage-launch-metric-label">
                      <Sparkles aria-hidden="true" size={14} strokeWidth={2.35} />
                      <span>Tiempo mas rapido</span>
                    </span>
                    <strong>
                      {formatCompletionTime(
                        ranking.reduce<number | null>((fastest, entry) => {
                          if (entry.completionTimeMs === null) {
                            return fastest;
                          }

                          if (fastest === null) {
                            return entry.completionTimeMs;
                          }

                          return Math.min(fastest, entry.completionTimeMs);
                        }, null),
                      )}
                    </strong>
                  </article>
                </div>
              </section>
            ) : null}

            {showRankingPreview ? (
              <div className="results-toolbar" aria-label="Controles de vista de resultados">
                <div className="results-toolbar-group" role="tablist" aria-label="Cambiar vista de resultados">
                  <button
                    type="button"
                    className={`results-tab results-tab-with-icon${resultsView === "spotlight" ? " is-active" : ""}`}
                    onClick={() => setResultsView("spotlight")}
                    aria-pressed={resultsView === "spotlight"}
                  >
                    <Sparkles aria-hidden="true" size={15} strokeWidth={2.3} className="results-tab-icon" />
                    <span>Spotlight</span>
                  </button>

                  {canUseCardsView ? (
                    <button
                      type="button"
                      className={`results-tab results-tab-with-icon${resultsView === "cards" ? " is-active" : ""}`}
                      onClick={() => setResultsView("cards")}
                      aria-pressed={resultsView === "cards"}
                    >
                      <Grid3X3 aria-hidden="true" size={15} strokeWidth={2.3} className="results-tab-icon" />
                      <span>Tarjetas</span>
                    </button>
                  ) : null}

                  <button
                    type="button"
                    className={`results-tab results-tab-with-icon${resultsView === "table" ? " is-active" : ""}`}
                    onClick={() => setResultsView("table")}
                    aria-pressed={resultsView === "table"}
                  >
                    <Table2 aria-hidden="true" size={15} strokeWidth={2.3} className="results-tab-icon" />
                    <span>Tabla</span>
                  </button>
                </div>
              </div>
            ) : null}

            {showRankingPreview && ranking.length >= 200 ? (
              <p className="stage-note">
                Modo conferencia activo: inicia en Spotlight para anunciar el top y usa Tabla para
                navegar todo el ranking sin alargar la pagina.
              </p>
            ) : null}

            {showRankingPreview && resultsView === "spotlight" ? (
              <div className="spotlight-grid">
                <div className="podium spotlight-podium">
                  {ranking.slice(0, 3).map((entry) => (
                    <article className={`podium-card rank-${entry.rank}`} key={`podium-${entry.rank}`}>
                      <p className="podium-rank">#{entry.rank}</p>
                      <h3>{entry.participant}</h3>
                      <p className="podium-company">{entry.company}</p>
                      <div className="podium-stats" aria-label="Metricas del participante">
                        <span className="top-score time-badge">
                          <span className="time-badge-label">Score</span>
                          <span>{percentFormatter.format(entry.totalScore)} pts</span>
                        </span>
                        <span className="time-badge">
                          <span className="time-badge-label">Tiempo</span>
                          <span>{formatCompletionTime(entry.completionTimeMs)}</span>
                        </span>
                      </div>
                    </article>
                  ))}
                </div>

                <section className="top-ten-board" aria-label="Top 10 general">
                  <h3>Top 10 General</h3>
                  <ol>
                    {ranking.slice(0, SPOTLIGHT_LIMIT).map((entry) => (
                      <li key={`top-${entry.rank}-${entry.participant}`}>
                        <span className="top-rank">#{entry.rank}</span>
                        <span className="top-name">{entry.participant}</span>
                        <span className="top-meta">
                          <span className="top-score time-badge">
                            <span className="time-badge-label">Score</span>
                            <span>{percentFormatter.format(entry.totalScore)}</span>
                          </span>
                          <span className="top-time time-badge">
                            <span className="time-badge-label">Tiempo</span>
                            <span>{formatCompletionTime(entry.completionTimeMs)}</span>
                          </span>
                        </span>
                      </li>
                    ))}
                  </ol>
                  {ranking.length > SPOTLIGHT_LIMIT ? (
                    <button
                      type="button"
                      className="secondary-button secondary-button-muted"
                      onClick={() => setResultsView(ranking.length >= 200 ? "table" : "cards")}
                    >
                      Ver ranking completo
                    </button>
                  ) : null}
                </section>
              </div>
            ) : null}

            {showRankingPreview && resultsView === "cards" ? (
              <>
                <div className="results-cards-grid" aria-label="Vista de tarjetas del ranking">
                  {compactRanking.map((entry) => (
                    <article
                      className={`result-card${entry.rank <= 3 ? ` rank-${entry.rank}` : ""}`}
                      key={`card-${entry.rank}-${entry.participant}-${entry.company}`}
                    >
                      <header>
                        <p className="podium-rank">#{entry.rank}</p>
                        <div className="result-card-metrics">
                          <span className="top-score time-badge">
                            <span className="time-badge-label">Score</span>
                            <span>{percentFormatter.format(entry.totalScore)} pts</span>
                          </span>
                          <span className="result-time time-badge">
                            <span className="time-badge-label">Tiempo</span>
                            <span>{formatCompletionTime(entry.completionTimeMs)}</span>
                          </span>
                        </div>
                      </header>
                      <h3>{entry.participant}</h3>
                      <p>{entry.company}</p>
                      <div className="chips">
                        {questions.map((question, questionIndex) => (
                          <span
                            key={`card-${entry.rank}-${question}`}
                            title={`Pregunta ${questionIndex + 1}: ${question}`}
                          >
                            P{questionIndex + 1}: {(entry.questionScores[question] * 100).toFixed(0)}%
                          </span>
                        ))}
                      </div>
                    </article>
                  ))}
                </div>

                {canLoadMoreCards ? (
                  <div className="load-more-wrap">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() =>
                        setVisibleRankingCount((current) =>
                          Math.min(current + COMPACT_BATCH_SIZE, ranking.length),
                        )
                      }
                    >
                      Mostrar mas participantes
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            {showRankingPreview && resultsView === "table" ? (
              <div className="results-table-wrap is-bounded" aria-label="Tabla completa de ranking">
                <table>
                  <caption className="sr-only">Resultados ordenados por puntuacion total</caption>
                  <thead>
                    <tr>
                      <th scope="col">Rank</th>
                      <th scope="col">Participante</th>
                      <th scope="col">Empresa</th>
                      <th scope="col">Score total</th>
                      <th scope="col">Tiempo</th>
                      <th scope="col">Detalle por pregunta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ranking.map((entry) => (
                      <tr key={`${entry.rank}-${entry.participant}-${entry.company}`}>
                        <td className="numeric-cell">#{entry.rank}</td>
                        <td>{entry.participant}</td>
                        <td>{entry.company}</td>
                        <td className="numeric-cell">{percentFormatter.format(entry.totalScore)}</td>
                        <td className="numeric-cell">{formatCompletionTime(entry.completionTimeMs)}</td>
                        <td>
                          <div className="chips">
                            {questions.map((question, questionIndex) => (
                              <span
                                key={`${entry.rank}-${question}`}
                                title={`Pregunta ${questionIndex + 1}: ${question}`}
                              >
                                {(entry.questionScores[question] * 100).toFixed(0)}%
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        ) : null}
      </main>
    </div>
  );
}
