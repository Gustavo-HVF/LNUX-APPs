# Gera os cenários de teste tests/dados/cenario-blender-*.blend (piso, parede filha de um vazio, coluna, macaca, materiais e
# uma textura embutida). Rode com o Blender (blender -b --python gerar_blend.py -- saida.blend --comprimir) ou com o módulo bpy.
import bpy, sys, math
saida = sys.argv[sys.argv.index("--") + 1]
comprimir = "--comprimir" in sys.argv
bpy.ops.wm.read_factory_settings(use_empty=True)
cena = bpy.context.scene
def material(nome, cor, imagem=None):
    m = bpy.data.materials.new(nome)
    m.use_nodes = True
    p = m.node_tree.nodes.get("Principled BSDF")
    p.inputs["Base Color"].default_value = (*cor, 1)
    p.inputs["Roughness"].default_value = 0.8
    if imagem:
        t = m.node_tree.nodes.new("ShaderNodeTexImage")
        t.image = imagem
        m.node_tree.links.new(t.outputs["Color"], p.inputs["Base Color"])
    return m
img = bpy.data.images.new("xadrez", 8, 8)
img.pixels = [v for y in range(8) for x in range(8) for v in ((1, 0.5, 0.1, 1) if (x + y) % 2 else (0.1, 0.3, 0.9, 1))]
img.filepath_raw = "//xadrez.png"; img.file_format = "PNG"
img.pack()
bpy.ops.mesh.primitive_plane_add(size=24, location=(0, 0, 1))
piso = bpy.context.object; piso.name = "Piso"; piso.data.materials.append(material("Chao", (0.3, 0.6, 0.3), img))
vazio = bpy.data.objects.new("Grupo", None); cena.collection.objects.link(vazio)
vazio.location = (0, 3.25, 0); vazio.rotation_euler = (0, 0, math.radians(0))
bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, 2.5))
parede = bpy.context.object; parede.name = "Parede"; parede.scale = (8, 0.5, 3); parede.parent = vazio
parede.data.materials.append(material("Tijolo", (0.8, 0.2, 0.2)))
bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=1, depth=2, location=(-6, -5, 2))
c = bpy.context.object; c.name = "Coluna"; c.data.materials.append(material("Pedra", (0.6, 0.6, 0.65)))
bpy.ops.mesh.primitive_monkey_add(size=1.5, location=(6, -5, 2.2)); bpy.context.object.name = "Macaca"
bpy.ops.wm.save_as_mainfile(filepath=saida, compress=comprimir)
bpy.ops.export_scene.gltf(filepath=saida.replace(".blend", "-referencia.glb"), export_format="GLB", export_apply=True)
print("salvo", saida, bpy.app.version_string)
