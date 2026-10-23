/**
 * A fake Orthanc for tests and the e2e server: one chest X-ray study (two
 * series) for RM 000002, served through an injected `fetch`. Images are small
 * synthetic grayscale PNGs, never patient data.
 */
import { Redacted } from "effect";
import { deflateSync } from "node:zlib";
import type { PacsOptions } from "@simha/tools";

export const FAKE_ORTHANC: PacsOptions = { url: "http://orthanc.test:8042", user: "orthanc", pass: Redacted.make("rahasia") };
export const FAKE_STUDY = "11111111-22222222-33333333-44444444-55555555";
export const FAKE_INSTANCES = [
  "aaaaaaaa-00000000-00000000-00000000-00000001",
  "aaaaaaaa-00000000-00000000-00000000-00000002",
  "aaaaaaaa-00000000-00000000-00000000-00000003",
] as const;

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Uint8Array) => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
};

/** A grayscale PNG: a soft bright oval on black, a little like a chest film. */
const syntheticPng = (size: number, seed: number) => {
  const rows: Array<Buffer> = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(size + 1);
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size * 0.42);
      const dy = (y - size / 2) / (size * (0.36 + seed * 0.04));
      const d = Math.sqrt(dx * dx + dy * dy);
      row[x + 1] = Math.max(0, Math.min(255, Math.round(220 * (1 - d) + 20 * Math.sin((x + y * seed) / 7))));
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
};

const study = {
  ID: FAKE_STUDY,
  MainDicomTags: {
    StudyDate: "20261021",
    StudyTime: "093015",
    StudyDescription: "THORAX PA",
    AccessionNumber: "RAD-0001",
    InstitutionName: "RS FIKTIF",
    StudyInstanceUID: "1.2.826.0.1.3680043.8.498.1",
  },
  Series: ["s2", "s1"],
};
const series = [
  { ID: "s2", MainDicomTags: { Modality: "CR", SeriesDescription: "LATERAL", SeriesNumber: "2", BodyPartExamined: "CHEST" }, Instances: [FAKE_INSTANCES[2]] },
  { ID: "s1", MainDicomTags: { Modality: "CR", SeriesDescription: "PA", SeriesNumber: "1", BodyPartExamined: "CHEST" }, Instances: [FAKE_INSTANCES[0], FAKE_INSTANCES[1]] },
];

/** Requests the fake received: method, path and Authorization header. */
interface FakeOrthancRequest {
  readonly method: string;
  readonly path: string;
  readonly body: string | null;
  readonly authorization: string | null;
}

export const makeFakeOrthanc = () => {
  const requests: Array<FakeOrthancRequest> = [];
  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const body = typeof init.body === "string" ? init.body : null;
    requests.push({ method: init.method ?? "GET", path: url.pathname + url.search, body, authorization: headers.get("authorization") });
    if (headers.get("authorization") !== `Basic ${Buffer.from("orthanc:rahasia").toString("base64")}`) return new Response("", { status: 401 });

    if (url.pathname === "/tools/find") {
      const query = (JSON.parse(body ?? "{}") as { Query?: { PatientID?: string } }).Query;
      return Response.json(query?.PatientID === "000002" ? [study] : []);
    }
    if (url.pathname === `/studies/${FAKE_STUDY}/series`) return Response.json(series);
    const image = /^\/instances\/([0-9a-f-]+)\/(rendered|preview|file)$/.exec(url.pathname);
    const index = image ? FAKE_INSTANCES.indexOf(image[1] as (typeof FAKE_INSTANCES)[number]) : -1;
    if (image && index >= 0) {
      if (image[2] === "file") return new Response(Buffer.from("DICM-fake"), { headers: { "content-type": "application/dicom" } });
      return new Response(syntheticPng(image[2] === "rendered" ? 160 : 512, index + 1), { headers: { "content-type": "image/png" } });
    }
    return new Response("", { status: 404 });
  };
  return { fetch, requests };
};
