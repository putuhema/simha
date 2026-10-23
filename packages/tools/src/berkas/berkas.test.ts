import { Effect } from "effect";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { berkasContentType, berkasKindOf, berkasUrl, makeBerkas, safeRelativePath } from "./Berkas.ts";

describe("berkas paths", () => {
  it("accepts the relative paths Khanza stores", () => {
    expect(safeRelativePath("berkas/2026/10/21/000002-hasil-lab.pdf")).toBe("2026/10/21/000002-hasil-lab.pdf");
    expect(safeRelativePath("webapps\\berkas\\2026\\foto.png")).toBe("2026/foto.png");
    expect(safeRelativePath("pages/upload/2026/foto.png")).toBe("2026/foto.png");
    expect(safeRelativePath("berkasrawat/pages/upload/foto.png")).toBe("foto.png");
    expect(safeRelativePath("2026/foto.png")).toBe("2026/foto.png");
  });

  it("rejects absolute, traversal and URL paths", () => {
    expect(safeRelativePath("/etc/passwd")).toBeNull();
    expect(safeRelativePath("\\\\server\\share\\a.png")).toBeNull();
    expect(safeRelativePath("../a.png")).toBeNull();
    expect(safeRelativePath("berkas/../../a.png")).toBeNull();
    expect(safeRelativePath("C:\\a.png")).toBeNull();
    expect(safeRelativePath("https://example.test/a.png")).toBeNull();
    expect(safeRelativePath("")).toBeNull();
  });

  it("builds an upload URL only below the configured base", () => {
    const base = "http://localhost:8080/webapps/berkasrawat/pages/upload/";
    expect(berkasUrl(base, "pages/upload/a.pdf")).toBe(`${base}a.pdf`);
    expect(berkasUrl("http://localhost:8080/webapps/berkasrawat/pages/upload", "a.png")).toBe(`${base}a.png`);
    expect(berkasUrl(base, "berkas/2026/a.png")).toBe(`${base}2026/a.png`);
    expect(berkasUrl(base, "../a.png")).toBeNull();
    expect(berkasUrl("file:///etc/passwd", "a.png")).toBeNull();
    expect(berkasUrl("", "a.png")).toBeNull();
  });

  it("classifies the files the card can preview", () => {
    expect(berkasKindOf("foto.PNG")).toBe("gambar");
    expect(berkasKindOf("hasil.pdf")).toBe("pdf");
    expect(berkasKindOf("surat.docx")).toBe("lainnya");
    expect(berkasContentType("foto.png")).toBe("image/png");
    expect(berkasContentType("hasil.pdf")).toBe("application/pdf");
    expect(berkasContentType("surat.docx")).toBe("application/octet-stream");
  });
});

describe("berkas over HTTP", () => {
  it("checks and reads a file through Khanza's upload URL", async () => {
    const body = Buffer.from([1, 2, 3]);
    const server = createServer((request, response) => {
      if (request.url !== "/webapps/berkasrawat/pages/upload/2026/a.png") {
        response.writeHead(404);
        response.end();
        return;
      }
      response.writeHead(200, { "content-type": "image/png", "content-length": String(body.length) });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      response.end(body);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no test server port");
    try {
      const berkas = makeBerkas({ dir: "", url: `http://127.0.0.1:${address.port}/webapps/berkasrawat/pages/upload/` });
      const info = await Effect.runPromise(berkas.info("pages/upload/2026/a.png"));
      expect(info).toEqual({ namaFile: "a.png", jenis: "gambar", ukuran: 3 });

      const content = await Effect.runPromise(berkas.read("pages/upload/2026/a.png"));
      expect(content.contentType).toBe("image/png");
      expect([...new Uint8Array(await content.response.arrayBuffer())]).toEqual([1, 2, 3]);

      const missing = await Effect.runPromise(Effect.result(berkas.info("pages/upload/2026/missing.png")));
      expect(missing._tag).toBe("Failure");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    }
  });
});
