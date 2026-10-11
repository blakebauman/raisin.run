import { handle } from './site';

export default {
  fetch: (request: Request) => handle(request),
};
