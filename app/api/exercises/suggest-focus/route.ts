import {
  EvaluationServiceError,
  parseFocusSuggestionRequest,
  suggestEvaluationFocus,
} from "../../../lib/llm/server";

export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  try {
    const input = parseFocusSuggestionRequest(await request.json());
    return Response.json(await suggestEvaluationFocus(input, request.signal), { headers });
  } catch (error) {
    if (error instanceof EvaluationServiceError) {
      return Response.json({ error: error.publicMessage }, { status: error.status, headers });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: "問題のJSONを読み取れませんでした。" }, { status: 400, headers });
    }
    console.error("Evaluation focus suggestion failed", error);
    return Response.json({ error: "評価観点の提案中にエラーが発生しました。" }, { status: 500, headers });
  }
}
