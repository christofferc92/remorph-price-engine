import crypto from "crypto";
import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import { execSync } from "child_process";
import OpenAI from "openai";
import { z } from "zod";

import { canonicalEstimatorContractSchema } from "../../../src/shared/canonicalEstimatorContractSchema.ts";
import { evaluateContract } from "../../../packages/price-engine/src/index.ts";

export const app = express();
const fsPromises = fs.promises;

const LOVABLE_PROJECT_REGEX = /^https:\/\/(?:.+\.)?lovableproject\.com$/i;
const LOVABLE_APP_REGEX = /^https:\/\/(?:.+\.)?lovable\.app$/i;
const USERCONTENT_GOOG_REGEX = /^https:\/\/(?:.+\.)?usercontent\.goog$/i;
const GOOGLEUSERCONTENT_COM_REGEX = /^https:\/\/(?:.+\.)?googleusercontent\.com$/i;
const LOCALHOST_REGEX = /^https?:\/\/localhost(?::\d+)?$/i;
const LOCALHOST_IPV4_REGEX = /^https?:\/\/127\.0\.0\.1(?::\d+)?$/i;

function isAllowedOrigin(origin?: string) {
  if (!origin) return false;
  return (
    LOCALHOST_REGEX.test(origin) ||
    LOCALHOST_IPV4_REGEX.test(origin) ||
    LOVABLE_PROJECT_REGEX.test(origin) ||
    LOVABLE_APP_REGEX.test(origin) ||
    USERCONTENT_GOOG_REGEX.test(origin) ||
    GOOGLEUSERCONTENT_COM_REGEX.test(origin)
  );
}

function setCorsHeaders(res: express.Response, origin: string) {
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "content-type");
}

function apiCorsMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.headers.origin;
  if (origin) {
    if (isAllowedOrigin(origin)) {
      setCorsHeaders(res, origin);
      if (req.method === "OPTIONS") {
        return res.sendStatus(204);
      }
    } else {
      console.warn(`[CORS] rejected origin ${origin} for ${req.method} ${req.path}`);
    }
  }
  next();
}

app.use("/api", apiCorsMiddleware);

app.use(express.json({ limit: "10mb" }));

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const storageRoot = resolveStorageRoot();
const isStorageEphemeral = storageRoot.startsWith(os.tmpdir());
const UPLOAD_FILES_DIR = path.join(storageRoot, "uploads", "files");
const UPLOAD_META_DIR = path.join(storageRoot, "uploads", "meta");
const ANALYSIS_CACHE_DIR = path.join(storageRoot, "analysis");
const ANALYSIS_CACHE_VERSION = 2;

ensureDirSync(UPLOAD_FILES_DIR);
ensureDirSync(UPLOAD_META_DIR);
ensureDirSync(ANALYSIS_CACHE_DIR);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES },
  fileFilter(_req, file, callback) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      return callback(null, true);
    }
    return callback(new Error("Only JPEG, PNG or WEBP images are accepted."));
  },
});

const openAiApiKey = process.env.OPENAI_API_KEY;
const OPENAI_MODEL = process.env.OPENAI_IMAGE_MODEL || "gpt-4o-mini";
const openAiClient = openAiApiKey ? new OpenAI({ apiKey: openAiApiKey }) : null;

const version = resolveGitSha();

function clamp(value: unknown, fallback = 0) {
  if (typeof value === "number") {
    return Math.min(Math.max(value, 0), 1);
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, 0), 1);
}

function toBoolean(value: unknown) {
  return Boolean(value);
}

function toNumber(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function isNormalizedAnalysisShape(payload: Record<string, unknown>) {
  const analysis = payload.analysis as Record<string, unknown> | undefined;
  if (!analysis) return false;
  return Boolean(analysis.size_estimate || analysis.surfaces || analysis.condition_signals);
}

function mapSizeToBucket(size?: number | null) {
  if (typeof size === "number") {
    if (size < 4) return "under_4_sqm";
    if (size <= 7) return "between_4_and_7_sqm";
    return "over_7_sqm";
  }
  return "between_4_and_7_sqm";
}

function deriveOverallCondition(signals?: Record<string, unknown>) {
  if (!signals) return "unknown";
  if (signals.moisture_signs) return "poor";
  if (signals.visible_damage) return "average";
  const wear = typeof signals.surface_wear === "string" ? signals.surface_wear : null;
  if (wear === "low") return "good";
  if (wear === "high") return "average";
  return "unknown";
}

function buildCanonicalOverrides(overrides: Record<string, unknown> | undefined, defaultBucket: string) {
  const bathroom_size_final =
    typeof overrides?.bathroom_size_final === "string"
      ? overrides.bathroom_size_final
      : defaultBucket;
  const bathroom_size_source =
    overrides?.bathroom_size_source === "user_overridden" ? "user_overridden" : "ai_estimated";
  return {
    ...overrides,
    bathroom_size_final,
    bathroom_size_source,
  };
}

function ensureOutcomeShowerNiches(payload: Record<string, unknown>) {
  const outcome = payload.outcome as Record<string, unknown> | undefined;
  if (outcome && outcome.shower_niches === undefined) {
    outcome.shower_niches = "none";
  }
}

function adaptNormalizedPayload(payload: Record<string, unknown>) {
  if (!isNormalizedAnalysisShape(payload)) {
    return null;
  }
  const normalizedAnalysis = payload.analysis as Record<string, unknown>;
  const outcome = payload.outcome as Record<string, unknown> | undefined;
  const surfaces = normalizedAnalysis.surfaces as Record<string, unknown> | undefined;
  const sizeEstimate = normalizedAnalysis.size_estimate as Record<string, unknown> | undefined;
  const floorArea = (sizeEstimate?.floor_area_m2 as Record<string, unknown> | undefined) ?? undefined;
  const measuredMid = toNumber(floorArea?.mid);
  const bucket = mapSizeToBucket(measuredMid);
  const analysis_confidence = clamp(normalizedAnalysis.analysis_confidence, 0.6);
  const detected = normalizedAnalysis.detected_fixtures as Record<string, unknown> | undefined;
  const canonicalAnalysis = {
    room_type:
      normalizedAnalysis.room_type === "bathroom" || normalizedAnalysis.room_type === "wc"
        ? "bathroom"
        : "other",
    bathroom_size_estimate: bucket,
    bathroom_size_confidence: clamp(sizeEstimate?.confidence, 0.5),
    detected_fixtures: {
      shower_present: toBoolean(detected?.shower_present),
      bathtub_present: toBoolean(detected?.bathtub_present),
      toilet_present: toBoolean(detected?.toilet_present),
      sink_present: toBoolean(detected?.sink_present),
    },
    layout_features: {
      shower_zone_visible: toBoolean(detected?.shower_present),
      wet_room_layout:
        normalizedAnalysis.room_type === "bathroom" || normalizedAnalysis.room_type === "wc",
      tight_space: measuredMid !== null ? measuredMid < 4 : false,
      irregular_geometry: false,
    },
    ceiling_features: {
      ceiling_visible: true,
      sloped_ceiling_detected:
        (typeof surfaces?.ceiling_type === "string" && surfaces.ceiling_type.startsWith("sloped")) ||
        (typeof outcome?.ceiling_type === "string" && outcome.ceiling_type.startsWith("sloped")),
    },
    condition_signals: {
      overall_condition: deriveOverallCondition(
        normalizedAnalysis.condition_signals as Record<string, unknown>
      ),
    },
    image_quality: {
      sufficient_for_estimate: analysis_confidence >= 0.5,
      issues: [],
    },
    analysis_confidence,
  };
  const overrides = buildCanonicalOverrides(payload.overrides as Record<string, unknown> | undefined, bucket);
  const adapted = {
    ...payload,
    analysis: canonicalAnalysis,
    overrides,
  };
  return adapted;
}

function createResultId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function handleEstimateRequest(req: express.Request, res: express.Response) {
  let payload = req.body as Record<string, unknown>;
  ensureOutcomeShowerNiches(payload);
  let parseResult = canonicalEstimatorContractSchema.safeParse(payload);
  if (!parseResult.success) {
    const adaptedPayload = adaptNormalizedPayload(payload);
    if (!adaptedPayload) {
      return res.status(400).json({
        error: "Invalid contract payload",
        details: parseResult.error.errors,
      });
    }
    ensureOutcomeShowerNiches(adaptedPayload);
    const adaptedParse = canonicalEstimatorContractSchema.safeParse(adaptedPayload);
    if (!adaptedParse.success) {
      return res.status(400).json({
        error: "Invalid contract payload",
        details: [
          ...parseResult.error.errors,
          ...adaptedParse.error.errors.map((issue) => ({ ...issue, source: "adapter" })),
        ],
      });
    }
    const origin = req.headers.origin ?? "unknown";
    console.info(`[estimate] ${req.method} ${req.path} origin=${origin} adapter_used=true`);
    payload = adaptedPayload;
    parseResult = adaptedParse;
  }

  const contract = parseResult.data;
  try {
    const contractResult = evaluateContract(contract);
    const metadata = {
      contract,
      overrides: contract.overrides,
      text: "",
      fileCount: 0,
    };
    return res.json({
      id: createResultId(),
      estimate: contractResult.clientEstimate,
      metadata,
      record: null,
    });
  } catch (err) {
    console.error("Price engine estimate failed", err);
    const detail = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: "Estimate failed", detail });
  }
}

app.post("/api/estimate", (req, res) => {
  void handleEstimateRequest(req, res);
});

app.post("/api/upload", upload.array("files"), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) {
      return res.status(400).json({ error: "No files uploaded" });
    }
    const records = [];
    for (const file of files) {
      const imageId = hashBuffer(file.buffer);
      const storedPath = path.join(UPLOAD_FILES_DIR, imageId);
      await fsPromises.writeFile(storedPath, file.buffer);
      const metadata = {
        image_id: imageId,
        filename: file.originalname,
        bytes: file.size ?? file.buffer.length,
        mime_type: file.mimetype,
        stored_at: new Date().toISOString(),
        stored_path: storedPath,
      };
      await fsPromises.writeFile(path.join(UPLOAD_META_DIR, `${imageId}.json`), JSON.stringify(metadata));
      records.push({
        image_id: imageId,
        filename: file.originalname,
        bytes: metadata.bytes,
        mime_type: file.mimetype,
      });
    }
    return res.json({ records });
  } catch (error) {
    console.error("Upload failed", error);
    return res.status(500).json({ error: "Upload failed", detail: error instanceof Error ? error.message : "Unknown" });
  }
});

app.post("/api/analyze", async (req, res) => {
  const imageId = typeof req.body?.image_id === "string" ? req.body.image_id.trim() : "";
  if (!imageId) {
    return res.status(400).json({ error: "image_id is required" });
  }
  const force = parseForceFlag(req.body?.force);
  const optionalText = typeof req.body?.optional_text === "string" ? req.body.optional_text.trim().slice(0, 600) : undefined;
  const metadata = await readJsonFile<UploadMetadata>(path.join(UPLOAD_META_DIR, `${imageId}.json`));
  if (!metadata) {
    return res.status(404).json({ error: "Image not found" });
  }
  const cachePath = path.join(ANALYSIS_CACHE_DIR, `${imageId}.json`);
  if (!force) {
    const cached = await readJsonFile<AnalysisCachePayload>(cachePath);
    if (cached?.cache_version === ANALYSIS_CACHE_VERSION) {
      return res.json({
        normalized: cached.normalized,
        record: cached.record,
        ai_raw: cached.ai_raw,
      });
    }
  }
  if (!openAiClient) {
    return res.status(503).json({ error: "OpenAI API key is not configured" });
  }
  try {
    const imageBuffer = await fsPromises.readFile(metadata.stored_path);
    const analysisResult = await analyzeWithAi(imageBuffer, metadata.mime_type, optionalText);
    const now = new Date().toISOString();
    const normalized: NormalizedResponse = {
      image_id: imageId,
      analysis: analysisResult.analysis,
      room: null,
      warnings: analysisResult.analysis.warnings,
      needs_confirmation_ids: [],
      timestamp: now,
    };
    const record: RecordResponse = {
      image_id: imageId,
      status: "validated",
      created_at: now,
      warnings: analysisResult.analysis.warnings,
    };
    const aiRaw: AiRaw = {
      model: OPENAI_MODEL,
      optional_text: optionalText,
      output_text: analysisResult.rawText,
      parsed_json: analysisResult.parsedJson,
      derived_analysis: analysisResult.analysis,
    };
    const cachePayload: AnalysisCachePayload = {
      cache_version: ANALYSIS_CACHE_VERSION,
      normalized,
      record,
      ai_raw: aiRaw,
    };
    await fsPromises.writeFile(cachePath, JSON.stringify(cachePayload));
    return res.json({ normalized, record, ai_raw: aiRaw });
  } catch (error) {
    console.error("Analysis failed", error);
    if (error instanceof AiValidationError) {
      return res.status(502).json({ error: "AI response invalid", detail: error.message });
    }
    return res.status(500).json({ error: "Analysis failed", detail: error instanceof Error ? error.message : "Unknown" });
  }
});

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "price-engine",
    version: version,
    storage: isStorageEphemeral ? "ephemeral" : "persistent",
  });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (res.headersSent) {
    return;
  }
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: "Upload error", detail: err.message });
  }
  console.error("Unhandled error", err);
  res.status(500).json({ error: "Internal server error" });
});

if (process.env.NODE_ENV !== "test") {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, "0.0.0.0", () => {
    console.log(`Price engine service ready on port ${port}`);
  });
}

type UploadMetadata = {
  image_id: string;
  filename: string;
  bytes: number;
  mime_type: string;
  stored_at: string;
  stored_path: string;
};

const roomTypeEnum = z.enum([
  "bathroom",
  "wc",
  "kitchen",
  "laundry",
  "living_space",
  "bedroom",
  "hallway",
  "storage",
  "other",
]);
const sizeBucketEnum = z.enum(["xs", "s", "m", "l", "xl"]);
const floorFinishEnum = z.enum(["tile", "vinyl", "wood", "other", "unknown"]);
const wallFinishEnum = z.enum(["fully_tiled", "partially_tiled", "painted", "unknown"]);
const ceilingTypeEnum = z.enum(["flat", "sloped", "unknown"]);
const surfaceWearEnum = z.enum(["low", "medium", "high", "unknown"]);

const optionalNumeric = z.union([z.number(), z.string(), z.null()]).optional();

const sizeEstimateSchema = z.object({
  floor_area_m2: z
    .object({
      low: optionalNumeric,
      mid: optionalNumeric,
      high: optionalNumeric,
    })
    .optional(),
  size_bucket: sizeBucketEnum.optional(),
  confidence: optionalNumeric,
  basis: z.array(z.string()).optional(),
  notes_sv: z.string().optional(),
});

const detectedFixturesSchema = z.object({
  shower_present: z.boolean().optional(),
  bathtub_present: z.boolean().optional(),
  toilet_present: z.boolean().optional(),
  sink_present: z.boolean().optional(),
  washing_machine_present: z.boolean().optional(),
});

const surfacesSchema = z.object({
  floor_finish: floorFinishEnum.optional(),
  wall_finish: wallFinishEnum.optional(),
  ceiling_type: ceilingTypeEnum.optional(),
});

const conditionSignalsSchema = z.object({
  visible_damage: z.boolean().optional(),
  moisture_signs: z.boolean().optional(),
  surface_wear: surfaceWearEnum.optional(),
});

const aiAnalysisV2Schema = z.object({
  room_type: roomTypeEnum,
  room_type_confidence: optionalNumeric,
  analysis_confidence: optionalNumeric,
  size_estimate: sizeEstimateSchema.optional(),
  detected_fixtures: detectedFixturesSchema.optional(),
  surfaces: surfacesSchema.optional(),
  condition_signals: conditionSignalsSchema.optional(),
  observations: z.array(z.string()).optional(),
  warnings: z.array(z.string()).optional(),
});

type AiAnalysisV2 = z.infer<typeof aiAnalysisV2Schema>;
type RoomType = z.infer<typeof roomTypeEnum>;
type SizeBucket = z.infer<typeof sizeBucketEnum>;
type FloorFinish = z.infer<typeof floorFinishEnum>;
type WallFinish = z.infer<typeof wallFinishEnum>;
type CeilingType = z.infer<typeof ceilingTypeEnum>;
type SurfaceWear = z.infer<typeof surfaceWearEnum>;

type DetectedFixtures = {
  shower_present: boolean;
  bathtub_present: boolean;
  toilet_present: boolean;
  sink_present: boolean;
  washing_machine_present: boolean;
};

type Surfaces = {
  floor_finish: FloorFinish;
  wall_finish: WallFinish;
  ceiling_type: CeilingType;
};

type ConditionSignals = {
  visible_damage: boolean;
  moisture_signs: boolean;
  surface_wear: SurfaceWear;
};

type FloorArea = {
  low: number;
  mid: number;
  high: number;
};

type SizeEstimate = {
  floor_area_m2: FloorArea;
  size_bucket: SizeBucket;
  confidence: number;
  basis: string[];
  notes_sv: string;
};

type RoomAnalysisV2 = {
  room_type: RoomType;
  room_type_confidence: number;
  analysis_confidence: number;
  size_estimate: SizeEstimate;
  detected_fixtures: DetectedFixtures;
  surfaces: Surfaces;
  condition_signals: ConditionSignals;
  observations: string[];
  warnings: string[];
};

type NormalizedResponse = {
  image_id: string;
  analysis: RoomAnalysisV2;
  room: null;
  warnings: string[];
  needs_confirmation_ids: string[];
  timestamp: string;
};

type RecordResponse = {
  image_id: string;
  status: "validated";
  created_at: string;
  warnings: string[];
};

type AiRaw = {
  model: string;
  optional_text?: string;
  output_text: string;
  parsed_json?: unknown;
  derived_analysis: RoomAnalysisV2;
};

type AnalysisCachePayload = {
  cache_version: number;
  normalized: NormalizedResponse;
  record: RecordResponse;
  ai_raw: AiRaw;
};

type AnalysisResult = {
  analysis: RoomAnalysisV2;
  rawText: string;
  parsedJson?: unknown;
};

type PromptItem = { type: "input_text"; text: string } | { type: "input_image"; image_url: string };

function hashBuffer(buffer: Buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function resolveStorageRoot() {
  const preferred = ["/data", path.resolve(process.cwd(), "data")];
  for (const candidate of preferred) {
    try {
      fs.mkdirSync(candidate, { recursive: true });
      return candidate;
    } catch {
      continue;
    }
  }
  const fallback = path.join(os.tmpdir(), "price-engine-uploads");
  try {
    fs.mkdirSync(fallback, { recursive: true });
  } catch (error) {
    console.error("Failed to create fallback storage directory", error);
  }
  return fallback;
}

function ensureDirSync(dir: string) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(`Failed to create ${dir}`, error);
  }
}

function resolveGitSha() {
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return null;
  }
}

function parseForceFlag(value: unknown) {
  if (value === true || value === 1) {
    return true;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true" || value === "1";
  }
  return false;
}

async function readJsonFile<T>(filePath: string): Promise<T | null> {
  try {
    const data = await fsPromises.readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

function clamp01(value: unknown) {
  if (typeof value === "number") {
    return Math.min(Math.max(value, 0), 1);
  }
  const parsed = Number(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return Math.min(Math.max(parsed, 0), 1);
}

function tryParseJson(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

class AiValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiValidationError";
  }
}

function formatOutputSnippet(text: unknown, maxLength = 400) {
  if (typeof text !== "string") {
    return "non-text response";
  }
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}...`;
}

const ANALYSIS_SYSTEM_PROMPT = `You are analyzing a room to describe its renovation scope. Return ONLY valid JSON. No markdown or commentary.
All keys in the target shape must be present; fill with conservative defaults when unsure.
Use Swedish for "warnings" and "size_estimate.notes_sv"; observations may be Swedish or English but prefer Swedish when natural.
If uncertain, widen size ranges, lower confidences, and include "unknown" in the "basis" array. Size is a rough prior; never claim precision. Remember that this analysis is an AI prior, so keep ranges and confidences conservative.
Target JSON shape:
{
  "room_type": "bathroom" | "wc" | "kitchen" | "laundry" | "living_space" | "bedroom" | "hallway" | "storage" | "other",
  "room_type_confidence": number (0..1),
  "analysis_confidence": number (0..1),
  "size_estimate": {
    "floor_area_m2": { "low": number, "mid": number, "high": number },
    "size_bucket": "xs" | "s" | "m" | "l" | "xl",
    "confidence": number (0..1),
    "basis": string[],
    "notes_sv": string (Swedish reasoning)
  },
  "detected_fixtures": {
    "shower_present": boolean,
    "bathtub_present": boolean,
    "toilet_present": boolean,
    "sink_present": boolean,
    "washing_machine_present": boolean
  },
  "surfaces": {
    "floor_finish": "tile" | "vinyl" | "wood" | "other" | "unknown",
    "wall_finish": "fully_tiled" | "partially_tiled" | "painted" | "unknown",
    "ceiling_type": "flat" | "sloped" | "unknown"
  },
  "condition_signals": {
    "visible_damage": boolean,
    "moisture_signs": boolean,
    "surface_wear": "low" | "medium" | "high" | "unknown"
  },
  "observations": string[],
  "warnings": string[]
}
Size bucket guidance: xs 0–3 m², s 3–5, m 5–8, l 8–12, xl 12+. If the mid value leaves the stated bucket, keep the bucket but mention the mismatch in warnings.
Use anchors such as a toilet width ≈0.7 m, sink depth ≈0.5 m, shower zone ≈0.8–1 m, door height ≈2.0 m, tile grid, cabinets, or wall spans while allowing low confidence.
Include basis entries like "toilet_scale", "sink_scale", "shower_zone", "wall_span", "camera_fov_guess", or "unknown" to explain how the size estimate was derived.
Call out any damage, moisture, or wear signs in the warnings.
Do not add extra keys beyond those listed.`;

function logAiValidationError(requestId: string | null, snippet: string, reason: string) {
  console.error(`[AI] request_id=${requestId ?? "unknown"} reason=${reason} snippet=${snippet}`);
}

function normalizeStringArray(values?: unknown[]) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((text) => Boolean(text));
}

function toNumericValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const sanitized = value.replace(",", ".");
    const parsed = Number(sanitized);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return 0;
}

const SIZE_BUCKET_RANGES: Record<SizeBucket, { min: number; max?: number }> = {
  xs: { min: 0, max: 3 },
  s: { min: 3, max: 5 },
  m: { min: 5, max: 8 },
  l: { min: 8, max: 12 },
  xl: { min: 12 },
};

function isSizeBucket(value: unknown): value is SizeBucket {
  return typeof value === "string" && sizeBucketEnum.options.includes(value as SizeBucket);
}

function isBucketMidConsistent(bucket: SizeBucket, mid: number) {
  if (mid <= 0) {
    return true;
  }
  const range = SIZE_BUCKET_RANGES[bucket];
  const minOk = range.min === undefined || mid >= range.min;
  const maxOk = range.max === undefined || mid <= range.max;
  return minOk && maxOk;
}

function createFallbackSizeEstimate(): SizeEstimate {
  return {
    floor_area_m2: { low: 0, mid: 0, high: 0 },
    size_bucket: "s",
    confidence: 0,
    basis: ["unknown"],
    notes_sv: "Osäker storleksuppskattning.",
  };
}

function normalizeSizeEstimate(raw: z.infer<typeof sizeEstimateSchema> | undefined, warnings: string[]): SizeEstimate {
  if (!raw) {
    warnings.push("Storleksuppskattning saknas, använder bucket \"s\" med låg säkerhet.");
    return createFallbackSizeEstimate();
  }
  const floorInput = raw.floor_area_m2 ?? {};
  const floorValues = [
    toNumericValue(floorInput.low),
    toNumericValue(floorInput.mid),
    toNumericValue(floorInput.high),
  ];
  const sortedFloor = [...floorValues].sort((a, b) => a - b);
  const floor_area_m2: FloorArea = {
    low: sortedFloor[0],
    mid: sortedFloor[1],
    high: sortedFloor[2],
  };
  const bucketInput = raw.size_bucket;
  const size_bucket: SizeBucket = isSizeBucket(bucketInput) ? bucketInput : "s";
  if (!isSizeBucket(bucketInput)) {
    warnings.push("Storleksbucket saknas eller ogiltig, använder \"s\" med låg säkerhet.");
  }
  let basis = Array.isArray(raw.basis)
    ? raw.basis.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean)
    : [];
  if (!basis.length) {
    basis = ["unknown"];
  }
  const confidence = clamp01(toNumericValue(raw.confidence));
  const notes_sv =
    typeof raw.notes_sv === "string" && raw.notes_sv.trim()
      ? raw.notes_sv.trim()
      : "Osäker storleksuppskattning.";

  if (floor_area_m2.low === 0 && floor_area_m2.mid === 0 && floor_area_m2.high === 0 && confidence > 0) {
    warnings.push("Golvareorna anges som 0 men confidence > 0 – tolka med försiktighet.");
  }
  if (!isBucketMidConsistent(size_bucket, floor_area_m2.mid)) {
    warnings.push(
      `Storleksbucket "${size_bucket}" stämmer inte med mittvärdet ${floor_area_m2.mid.toFixed(1)} m².`
    );
  }

  return {
    floor_area_m2,
    size_bucket,
    confidence,
    basis,
    notes_sv,
  };
}

function normalizeAnalysis(payload: AiAnalysisV2): RoomAnalysisV2 {
  const observations = normalizeStringArray(payload.observations);
  const warnings = normalizeStringArray(payload.warnings);
  const size_estimate = normalizeSizeEstimate(payload.size_estimate, warnings);
  const fixtures = payload.detected_fixtures ?? {};
  const surfaces = payload.surfaces ?? {};
  const conditionSignals = payload.condition_signals ?? {};
  const analysisConfidence = clamp01(toNumericValue(payload.analysis_confidence));
  const roomTypeConfidence =
    payload.room_type_confidence !== undefined && payload.room_type_confidence !== null
      ? clamp01(toNumericValue(payload.room_type_confidence))
      : payload.analysis_confidence !== undefined && payload.analysis_confidence !== null
        ? clamp01(toNumericValue(payload.analysis_confidence))
        : 0.5;

  return {
    room_type: payload.room_type,
    room_type_confidence: roomTypeConfidence,
    analysis_confidence: analysisConfidence,
    size_estimate,
    detected_fixtures: {
      shower_present: Boolean(fixtures.shower_present),
      bathtub_present: Boolean(fixtures.bathtub_present),
      toilet_present: Boolean(fixtures.toilet_present),
      sink_present: Boolean(fixtures.sink_present),
      washing_machine_present: Boolean(fixtures.washing_machine_present),
    },
    surfaces: {
      floor_finish: surfaces.floor_finish ?? "unknown",
      wall_finish: surfaces.wall_finish ?? "unknown",
      ceiling_type: surfaces.ceiling_type ?? "unknown",
    },
    condition_signals: {
      visible_damage: Boolean(conditionSignals.visible_damage),
      moisture_signs: Boolean(conditionSignals.moisture_signs),
      surface_wear: conditionSignals.surface_wear ?? "unknown",
    },
    observations,
    warnings,
  };
}

async function analyzeWithAi(imageBuffer: Buffer, mimeType: string, optionalText?: string): Promise<AnalysisResult> {
  const promptItems = [
    {
      type: "input_text" as const,
      text: "Extract renovation-focused details for the attached room: room type, fixtures, surfaces, condition signals, and an approximate size estimate. Size must include low/mid/high, bucket, confidence, basis, and a Swedish notes_sv describing how you judged the scale. Follow the system prompt exactly and mention any reasoning for the basis entries.",
    },
    optionalText
      ? {
        type: "input_text" as const,
        text: `Customer context: ${optionalText}`,
      }
      : null,
    {
      type: "input_image" as const,
      image_url: `data:${mimeType};base64,${imageBuffer.toString("base64")}`,
    },
  ].filter((item): item is PromptItem => Boolean(item));
  const response = await openAiClient!.responses.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    max_output_tokens: 600,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text" as const,
            text: ANALYSIS_SYSTEM_PROMPT,
          },
        ],
      },
      {
        role: "user",
        content: promptItems,
      },
    ],
  });
  const requestId = (response as any).request_id ?? (response as any).id ?? null;
  const outputText = (response as any).output_text ?? "";
  const snippet = formatOutputSnippet(outputText);
  const initial = tryParseJson(outputText);
  if (!initial) {
    logAiValidationError(requestId, snippet, "JSON parse failed");
    throw new AiValidationError(`OpenAI response did not return JSON output (output_text: ${snippet})`);
  }
  const parsed = aiAnalysisV2Schema.safeParse(initial);
  if (!parsed.success) {
    logAiValidationError(requestId, snippet, "schema validation failed");
    throw new AiValidationError(
      `OpenAI response failed schema validation: ${parsed.error.message} (output_text: ${snippet})`
    );
  }
  const analysis = normalizeAnalysis(parsed.data);
  return {
    analysis,
    rawText: typeof outputText === "string" ? outputText : "",
    parsedJson: initial,
  };
}
