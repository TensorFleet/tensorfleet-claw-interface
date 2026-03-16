export interface TensorfleetTelemetryEntityRead {
  /**
   * Entity id to read from. Use `--list` to get a list of available entities (and pass empty array for `parameters`)
   */
  entity_id: string;
  /**
   * A list of parameters to read from. Use `["--list"]` to get a list of available parameters
   */
  parameters: string[];
  /**
   * The return type for the response, defaults to JSON
   */
  return_type?: string;
  /**
   * .tensorfleet file absolute path. found in the root of a tensorfleet project folder
   */
  "config-file": string;
}
