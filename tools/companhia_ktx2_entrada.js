// O codificador de texturas KTX2 (Basis Universal) da Companhia, montado por tools/montar_vrm.sh: só é baixado quando
// a pessoa escolhe gravar o cenário com texturas KTX2 (js/ktx2.js). O WebAssembly fica em vendor/ktx2/.
import { encodeToKTX2 } from "ktx2-encoder";
window.CompanhiaKTX2 = { encodeToKTX2 };
