import { onRequestPost as __api_feedback_js_onRequestPost } from "/Users/soti/Claude/npu2/functions/api/feedback.js"

export const routes = [
    {
      routePath: "/api/feedback",
      mountPath: "/api",
      method: "POST",
      middlewares: [],
      modules: [__api_feedback_js_onRequestPost],
    },
  ]