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
   * Tensorfleet project directory path. The directory should contain both .tensorfleet and .env files at its root
   */
  "tensorfleet-project-path": string;
}
