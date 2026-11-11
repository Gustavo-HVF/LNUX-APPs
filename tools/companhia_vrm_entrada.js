// Pacote do three.js + carregadores (glTF, FBX, BVH, OBJ, Draco, Meshopt) + three-vrm + three-vrm-animation + three-mesh-bvh
// para a Companhia (montado por tools/montar_vrm.sh).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { BVHLoader } from "three/examples/jsm/loaders/BVHLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VRMAnimationLoaderPlugin } from "@pixiv/three-vrm-animation";
import { MeshBVH, StaticGeometryGenerator } from "three-mesh-bvh";
window.THREE = THREE;
window.CompanhiaVRM = {
  GLTFLoader, FBXLoader, BVHLoader, OBJLoader, DRACOLoader, MeshoptDecoder, RoomEnvironment,
  VRMLoaderPlugin, VRMUtils, VRMAnimationLoaderPlugin, MeshBVH, StaticGeometryGenerator,
};
