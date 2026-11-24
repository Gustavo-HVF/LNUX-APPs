# Gera as personagens de teste tests/dados/personagem-blender-*.blend: um boneco de caixas em pose em A (os braços um
# pouco abaixados e as pernas um pouco abertas), com a armadura de pessoa (Hips, Spine, Chest, Neck, Head, braços com a mão,
# pernas com o pé), os grupos de vértices com os pesos de cada parte, duas formas no rosto (vrc.blink e vrc.v_aa) e uma
# textura embutida ligada num shader Diffuse (não no Principled).
#   personagem-blender-5.3.blend: com a armadura;
#   personagem-sem-armadura-5.3.blend: a mesma, sem a armadura (só os grupos de vértices, como muitos modelos do Sketchfab).
# Rode com o Blender (blender -b --python gerar_personagem_blend.py -- pasta) ou com o módulo bpy.
import bpy, bmesh, sys, os, math
from mathutils import Vector, Matrix

pasta = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else os.path.dirname(os.path.abspath(__file__))
bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene

# os ossos: nome → (cabeça, cauda, pai)
A = math.radians(35)  # o braço desce 35° (pose em A)
def braco(lado):
    s = 1 if lado == "L" else -1
    ombro = Vector((0.08 * s, 0, 1.38))
    dirb = Vector((math.cos(A) * s, 0, -math.sin(A)))
    cot = ombro + Vector((0.08 * s, 0, 0)) + dirb * 0.26
    pulso = cot + dirb * 0.24
    return {
        f"Shoulder_{lado}": (ombro, ombro + Vector((0.08 * s, 0, 0)), "Chest"),
        f"UpperArm_{lado}": (ombro + Vector((0.08 * s, 0, 0)), cot, f"Shoulder_{lado}"),
        f"LowerArm_{lado}": (cot, pulso, f"UpperArm_{lado}"),
        f"Hand_{lado}": (pulso, pulso + dirb * 0.1, f"LowerArm_{lado}"),
    }
def perna(lado):
    s = 1 if lado == "L" else -1
    return {
        f"UpperLeg_{lado}": (Vector((0.09 * s, 0, 0.9)), Vector((0.1 * s, 0, 0.5)), "Hips"),
        f"LowerLeg_{lado}": (Vector((0.1 * s, 0, 0.5)), Vector((0.1 * s, 0, 0.08)), f"UpperLeg_{lado}"),
        f"Foot_{lado}": (Vector((0.1 * s, 0, 0.08)), Vector((0.1 * s, -0.14, 0.02)), f"LowerLeg_{lado}"),
    }
OSSOS = {
    "Hips": (Vector((0, 0, 0.92)), Vector((0, 0, 1.02)), None),
    "Spine": (Vector((0, 0, 1.02)), Vector((0, 0, 1.18)), "Hips"),
    "Chest": (Vector((0, 0, 1.18)), Vector((0, 0, 1.42)), "Spine"),
    "Neck": (Vector((0, 0, 1.42)), Vector((0, 0, 1.5)), "Chest"),
    "Head": (Vector((0, 0, 1.5)), Vector((0, 0, 1.75)), "Neck"),
    **braco("L"), **braco("R"), **perna("L"), **perna("R"),
}

# a malha: uma caixa por osso (com cortes no meio, para dobrar), cada uma no grupo do osso
bm = bmesh.new()
grupos_dos_vertices = []
def caixa(cabeca, cauda, larg, nome):
    eixo = (cauda - cabeca)
    comp = eixo.length
    rot = eixo.normalized().to_track_quat("Z", "Y").to_matrix().to_4x4()
    m = Matrix.Translation((cabeca + cauda) / 2) @ rot @ Matrix.Diagonal((larg, larg, comp, 1))
    r = bmesh.ops.create_cube(bm, size=1, matrix=m)
    for v in r["verts"]: grupos_dos_vertices.append((v, nome))
for nome, (c, t, _) in OSSOS.items():
    larg = {"Head": 0.2, "Chest": 0.26, "Spine": 0.22, "Hips": 0.24, "Neck": 0.08}.get(nome, 0.07)
    if nome.startswith("Shoulder"): larg = 0.06
    caixa(c, t, larg, nome)
bm.verts.ensure_lookup_table()
malha = bpy.data.meshes.new("Corpo")
bm.to_mesh(malha)
obj = bpy.data.objects.new("Corpo", malha)
cena.collection.objects.link(obj)
grupos = {n: obj.vertex_groups.new(name=n) for n in OSSOS}
nomes_dos_vertices = [nome for _, nome in grupos_dos_vertices]
bm.free()
for i, nome in enumerate(nomes_dos_vertices):
    grupos[nome].add([i], 1.0, "REPLACE")
    # perto da junta com o pai, o pai também puxa (a junta dobra macio)
    pai = OSSOS[nome][2]
    if pai and (malha.vertices[i].co - OSSOS[nome][0]).length < 0.06: grupos[pai].add([i], 0.4, "ADD")
# o mapa UV e o material (Diffuse com uma imagem embutida)
malha.uv_layers.new(name="UV")
img = bpy.data.images.new("pele", 8, 8)
img.pixels = [v for y in range(8) for x in range(8) for v in ((0.95, 0.75, 0.6, 1) if (x + y) % 2 else (0.85, 0.6, 0.5, 1))]
img.filepath_raw = "//pele.png"; img.file_format = "PNG"; img.pack()
mat = bpy.data.materials.new("Pele"); mat.use_nodes = True
nos = mat.node_tree.nodes
for n in list(nos): nos.remove(n)
saida = nos.new("ShaderNodeOutputMaterial"); dif = nos.new("ShaderNodeBsdfDiffuse"); tex = nos.new("ShaderNodeTexImage"); tex.image = img
mat.node_tree.links.new(tex.outputs["Color"], dif.inputs["Color"]); mat.node_tree.links.new(dif.outputs["BSDF"], saida.inputs["Surface"])
malha.materials.append(mat)
# as formas do rosto: piscar (a frente da cabeça desce) e "a" (a parte de baixo da cabeça abre)
obj.shape_key_add(name="Basis")
piscar = obj.shape_key_add(name="vrc.blink"); boca = obj.shape_key_add(name="vrc.v_aa")
for i, nome in enumerate(nomes_dos_vertices):
    if nome != "Head": continue
    if malha.vertices[i].co.z > 1.62: piscar.data[i].co.z -= 0.02
    else: boca.data[i].co.z -= 0.03
# a armadura
arm = bpy.data.armatures.new("Armadura")
ob_arm = bpy.data.objects.new("Armadura", arm)
cena.collection.objects.link(ob_arm)
bpy.context.view_layer.objects.active = ob_arm
bpy.ops.object.mode_set(mode="EDIT")
for nome, (c, t, pai) in OSSOS.items():
    b = arm.edit_bones.new(nome); b.head = c; b.tail = t
for nome, (_, _, pai) in OSSOS.items():
    if pai: arm.edit_bones[nome].parent = arm.edit_bones[pai]
bpy.ops.object.mode_set(mode="OBJECT")
obj.parent = ob_arm
mod = obj.modifiers.new("Armature", "ARMATURE"); mod.object = ob_arm

com = os.path.join(pasta, "personagem-blender-5.3.blend")
bpy.ops.wm.save_as_mainfile(filepath=com, compress=True)
# sem a armadura: só os grupos de vértices ficam
obj.modifiers.remove(mod); obj.parent = None
bpy.data.objects.remove(ob_arm); bpy.data.armatures.remove(arm)
sem = os.path.join(pasta, "personagem-sem-armadura-5.3.blend")
bpy.ops.wm.save_as_mainfile(filepath=sem, compress=True)
print("salvo", com, sem, bpy.app.version_string)
