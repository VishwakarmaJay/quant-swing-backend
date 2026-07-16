export type ParsedResponse = {
  message: string;
  error: unknown;
  stack?: string | undefined;
  statusCode: number;
};

export type ParsedError = {
  message: string;
  stack?: string | undefined;
};
