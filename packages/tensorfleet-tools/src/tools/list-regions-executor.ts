import { listRegionsTool } from "./list-regions";

export async function executeListRegions(_id: string, params: { includeDev?: boolean }) {
  return await listRegionsTool(_id, params);
}