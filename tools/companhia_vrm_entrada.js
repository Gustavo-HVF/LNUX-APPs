// Pacote do three.js + carregadores (glTF, FBX, BVH, OBJ/MTL, Collada, STL, PLY, 3DS, 3MF, USDZ, Draco, Meshopt) +
// exportador de glTF + three-vrm + three-vrm-animation + three-mesh-bvh para a Companhia (montado por tools/montar_vrm.sh).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { TDSLoader } from "three/examples/jsm/loaders/TDSLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { USDZLoader } from "three/examples/jsm/loaders/USDZLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { ZSTDDecoder } from "three/examples/jsm/libs/zstddec.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { toCreasedNormals } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
import { MeshBVH, StaticGeometryGenerator } from "three-mesh-bvh";
window.THREE = THREE;
window.CompanhiaVRM = {
  GLTFLoader, FBXLoader, BVHLoader, OBJLoader, MTLLoader, ColladaLoader, STLLoader, PLYLoader, TDSLoader, ThreeMFLoader, USDZLoader,
  DRACOLoader, GLTFExporter, MeshoptDecoder, ZSTDDecoder, RoomEnvironment, toCreasedNormals,
  VRMLoaderPlugin, VRMUtils, VRMAnimationLoaderPlugin, MeshBVH, StaticGeometryGenerator,
};
