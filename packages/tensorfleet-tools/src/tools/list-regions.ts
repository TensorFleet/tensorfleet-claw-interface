import { getAvailableRegions } from "tensorfleet-auth";

export interface ListRegionsParams {
  includeDev?: boolean;
}

export async function listRegionsTool(_id: string, params: ListRegionsParams) {
  try {
    const includeDev = params.includeDev ?? false;
    const regions = getAvailableRegions(includeDev);

    const formattedRegions = Object.entries(regions).map(([, config]) => ({
      id: config.id,
      name: config.name,
      description: config.description,
      vmManagerUrl: config.vmManagerUrl,
      devOnly: config.devOnly ?? false,
    }));

    const responseText = JSON.stringify(
      {
        success: true,
        regions: formattedRegions,
      },
      null,
      2
    );

    return {
      content: [
        {
          type: "text",
          text: responseText || "",
        },
      ],
    };
  } catch (error) {
    const errorText = JSON.stringify(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error occurred",
      },
      null,
      2
    );

    return {
      content: [
        {
          type: "text",
          text: errorText || "",
        },
      ],
    };
  }
}