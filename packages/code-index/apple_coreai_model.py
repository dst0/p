"""ANE-oriented Qwen embedding model wrapper used by the Core AI exporter."""

import torch


class AppleCoreAIEmbeddingModel(torch.nn.Module):
    """Expose only the Qwen transformer in Core AI's ANE-friendly BC1S layout."""

    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(
        self,
        token_embeddings: torch.Tensor,
        rope_cos: torch.Tensor,
        rope_sin: torch.Tensor,
        causal_mask: torch.Tensor,
    ) -> torch.Tensor:
        in_step = torch.zeros((1,), dtype=torch.int32)
        return self.model(
            token_embeddings,
            rope_cos,
            rope_sin,
            in_step,
            causal_mask,
        )
