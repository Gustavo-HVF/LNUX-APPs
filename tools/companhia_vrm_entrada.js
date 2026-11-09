// Pacote do three.js + carregador de glTF + three-vrm para a Companhia (montado por tools/montar_vrm.sh)
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
window.THREE = THREE;
window.CompanhiaVRM = { GLTFLoader, VRMLoaderPlugin, VRMUtils };
