// Rastreamento pela câmera para a Companhia: o MediaPipe Tasks Vision (Google, Apache-2.0) rodando num Worker,
// para o desenho da personagem não travar enquanto o rosto, o corpo e as mãos são procurados na imagem.
// Montado por tools/montar_vrm.sh em apps/companhia/vendor/mediapipe-visao.min.js (a página usa como Worker).
//
// Página → Worker:  {tipo: "iniciar", wasmJs: Blob, wasmBin: Blob, modelos: {rosto, corpo, maos: ArrayBuffer}, delegado}
//                   {tipo: "quadro", imagem: ImageBitmap, t, partes: {rosto, corpo, maos}, pontosDoRosto}
// Worker → Página:  {tipo: "pronto", delegado: {rosto, corpo, maos}} | {tipo: "erro", mensagem}
//                   {tipo: "resultado", t, ms, rosto, corpo, maos}
import { FilesetResolver, FaceLandmarker, PoseLandmarker, HandLandmarker } from "@mediapipe/tasks-vision";

const tarefas = { rosto: null, corpo: null, maos: null };
const usados = {};

async function criar(Classe, arquivos, modelo, delegado, extras) {
  const opcoes = (d) => ({ baseOptions: { modelAssetBuffer: new Uint8Array(modelo), delegate: d }, runningMode: "VIDEO", ...extras });
  if (delegado !== "CPU") {
    try { return [await Classe.createFromOptions(arquivos, opcoes("GPU")), "GPU"]; } catch (e) { /* sem placa de vídeo no Worker: vai pelo processador */ }
  }
  return [await Classe.createFromOptions(arquivos, opcoes("CPU")), "CPU"];
}

async function iniciar(m) {
  const arquivos = { wasmLoaderPath: URL.createObjectURL(m.wasmJs), wasmBinaryPath: URL.createObjectURL(m.wasmBin) };
  const mm = m.modelos || {};
  if (mm.rosto) [tarefas.rosto, usados.rosto] = await criar(FaceLandmarker, arquivos, mm.rosto, m.delegado, { numFaces: 1, outputFaceBlendshapes: true, outputFacialTransformationMatrixes: true });
  if (mm.corpo) [tarefas.corpo, usados.corpo] = await criar(PoseLandmarker, arquivos, mm.corpo, m.delegado, { numPoses: 1 });
  if (mm.maos) [tarefas.maos, usados.maos] = await criar(HandLandmarker, arquivos, mm.maos, m.delegado, { numHands: 2 });
  postMessage({ tipo: "pronto", delegado: usados });
}

const ponto = (p) => [p.x, p.y, p.z, p.visibility === undefined ? 1 : p.visibility];

function quadro(m) {
  const t0 = performance.now();
  const r = { tipo: "resultado", t: m.t, rosto: null, corpo: null, maos: null };
  const partes = m.partes || {};
  try {
    if (tarefas.rosto && partes.rosto) {
      const f = tarefas.rosto.detectForVideo(m.imagem, m.t);
      if (f.faceBlendshapes && f.faceBlendshapes[0]) {
        const formas = {};
        for (const c of f.faceBlendshapes[0].categories) formas[c.categoryName] = c.score;
        r.rosto = { formas, matriz: f.facialTransformationMatrixes && f.facialTransformationMatrixes[0] ? Array.from(f.facialTransformationMatrixes[0].data) : null };
        if (m.pontosDoRosto && f.faceLandmarks[0]) {
          const pts = new Float32Array(f.faceLandmarks[0].length * 2);
          f.faceLandmarks[0].forEach((p, i) => { pts[i * 2] = p.x; pts[i * 2 + 1] = p.y; });
          r.rosto.pontos = pts;
        }
      }
    }
    if (tarefas.corpo && partes.corpo) {
      const p = tarefas.corpo.detectForVideo(m.imagem, m.t);
      if (p.worldLandmarks && p.worldLandmarks[0]) r.corpo = { mundo: p.worldLandmarks[0].map(ponto), imagem: p.landmarks[0].map(ponto) };
      if (p.close) p.close();
    }
    if (tarefas.maos && partes.maos) {
      const h = tarefas.maos.detectForVideo(m.imagem, m.t);
      r.maos = (h.worldLandmarks || []).map((mundo, i) => ({
        lado: ((h.handedness || h.handednesses || [])[i] || [{}])[0].categoryName || "", confianca: ((h.handedness || h.handednesses || [])[i] || [{}])[0].score || 0,
        mundo: mundo.map(ponto), imagem: h.landmarks[i].map(ponto),
      }));
    }
  } finally {
    if (m.imagem && m.imagem.close) m.imagem.close();
  }
  r.ms = performance.now() - t0;
  postMessage(r);
}

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.tipo === "iniciar") iniciar(m).catch((erro) => postMessage({ tipo: "erro", mensagem: String((erro && erro.message) || erro) }));
  else if (m.tipo === "quadro") { try { quadro(m); } catch (erro) { postMessage({ tipo: "erro", mensagem: String((erro && erro.message) || erro), quadro: true }); } }
  else if (m.tipo === "fechar") { for (const t of Object.values(tarefas)) { try { if (t) t.close(); } catch (erro) { /* já fechou */ } } close(); }
};
