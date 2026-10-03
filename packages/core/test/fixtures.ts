import { Scene, TemplateLibrary } from "@superworld/schema";
import plazaJson from "../../../content/world/plaza.scene.json" with { type: "json" };
import templatesJson from "../../../content/world/templates.json" with { type: "json" };

export const plaza = Scene.parse(plazaJson);
export const templates = TemplateLibrary.parse(templatesJson);
