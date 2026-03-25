import * as fs from "fs";
import * as path from "path";

/**
 * Helper function to load schema from file
 * @param filename - The name of the schema file to load
 * @returns The parsed JSON schema object
 */
export function loadSchema(filename: string) {
  const schemaPath = path.join(__dirname, "../schema", filename);
  const schemaContent = fs.readFileSync(schemaPath, "utf8");
  return JSON.parse(schemaContent);
}