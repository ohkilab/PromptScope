import {
  EvaluationServiceError,
  evaluatePlanWithLlm,
  parseEvaluationRequest,
} from "../../lib/llm/server";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const evaluationRequest = parseEvaluationRequest(payload);
    const evaluation = await evaluatePlanWithLlm(evaluationRequest, request.signal);
    return Response.json(evaluation, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof EvaluationServiceError) {
      return Response.json(
        { error: error.publicMessage },
        { status: error.status, headers: { "Cache-Control": "no-store" } },
      );
    }

    const message = error instanceof SyntaxError
      ? "採点対象のJSONを読み取れませんでした。"
      : "採点中に予期しないエラーが発生しました。";
    console.error("LLM evaluation failed", error);
    return Response.json(
      { error: message },
      { status: error instanceof SyntaxError ? 400 : 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
