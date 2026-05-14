export interface TensorfleetTelemetryEntityRead {
  /**
   * Entity id to read from. Use `--list` to get a list of available entities in the `entity-type-map` section (and pass empty array for `parameters`)
   */
  entity_id: string;
  /**
   * A list of parameters to read from. Use `["--list"]` to get a list of available `parameters` (in the `entity_params` section) to read along with the entire metadata of the requested entity
   */
  parameters: string[];
  /**
   * The return type for the response, defaults to JSON
   */
  return_type?: string;
  /**
   * Optional Tensorfleet project directory path for legacy .tensorfleet/.env fallback. Omit when using in-memory auth and config-store values.
   */
  "tensorfleet-project-path"?: string;
  /**
   * Regex filter to apply to the query
   */
  regex_filter?: string;
}
