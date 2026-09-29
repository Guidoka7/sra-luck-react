import { describe, expect, it } from "vitest";
import { normalizarUrlImagem, urlImagemRecompensa } from "./clube-imagens";

describe("imagem das recompensas do Clube", () => {
  it("recusa a miniatura temporária do Dropbox (quebrou a Nécessaire premium em 25/09)", () => {
    const r = normalizarUrlImagem("https://previews.dropbox.com/p/thumb/ADKzQCht3MRbs/p.png?is_prewarmed=true");
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.erro).toMatch(/temporário/);
  });

  it("link de compartilhamento do Dropbox abre a imagem direto (raw=1)", () => {
    const r = normalizarUrlImagem("https://www.dropbox.com/scl/fi/abc/necessaire.png?rlkey=xyz&dl=0");
    expect(r).toEqual({ ok: true, url: "https://www.dropbox.com/scl/fi/abc/necessaire.png?rlkey=xyz&raw=1" });
  });

  it("aceita https e a rota interna das imagens enviadas; recusa http e texto", () => {
    expect(normalizarUrlImagem("https://cdn.exemplo.com/a.webp")).toEqual({ ok: true, url: "https://cdn.exemplo.com/a.webp" });
    const interna = urlImagemRecompensa("11111111-1111-4111-8111-111111111111", "1727600000000");
    expect(normalizarUrlImagem(interna)).toEqual({ ok: true, url: interna });
    expect(normalizarUrlImagem("http://exemplo.com/a.png")).toMatchObject({ ok: false });
    expect(normalizarUrlImagem("imagem.png")).toMatchObject({ ok: false });
  });
});
