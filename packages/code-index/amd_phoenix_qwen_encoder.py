"""Full Qwen3 embedding encoder orchestrated through Phoenix IRON operators."""

import math
import os
from typing import Any

import numpy as np
from ml_dtypes import bfloat16
from safetensors import safe_open
from transformers import AutoConfig, AutoTokenizer

from amd_phoenix_iron_ops import AmdPhoenixIronOps


class AmdPhoenixQwenEncoder:
    def __init__(self, spec, manifest, runtime_config):
        self.spec = spec
        self.manifest = manifest
        self.runtime_config = runtime_config
        self.config = AutoConfig.from_pretrained(manifest["modelPath"])
        self.tokenizer = AutoTokenizer.from_pretrained(manifest["modelPath"])
        self.weights = safe_open(
            os.path.join(manifest["modelPath"], "model.safetensors"),
            framework="pt",
            device="cpu",
        )
        self.embedding_table = self.weights.get_tensor("embed_tokens.weight")
        self.sequence_lengths = tuple(sorted(manifest["sequenceLengths"]))
        self.ops = AmdPhoenixIronOps(
            runtime_config.amd_iron_source_directory,
            runtime_config.amd_iron_cache_directory,
        )
        self._validate_model_shape()

    def encode(self, texts, normalize=True, batch_size=8, cancellation_check=None):
        del batch_size
        outputs = []
        for text in texts:
            self._raise_if_cancelled(cancellation_check)
            outputs.append(self._encode_one(text, cancellation_check))
        embeddings = np.vstack(outputs) if outputs else np.empty((0, self.spec.dimensions))
        if normalize and len(embeddings):
            norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
            embeddings = embeddings / np.clip(norms, 1e-9, None)
        return embeddings.astype(np.float32).tolist()

    def dispatch_probe(self) -> dict[str, Any]:
        if self.ops.dispatch_count == 0:
            self.encode(["Phoenix full encoder validation"], normalize=True, batch_size=1)
        return {"deviceGeneration": "npu1", **self.ops.proof()}

    def dispatch_proof(self) -> dict[str, Any]:
        return {"deviceGeneration": "npu1", **self.ops.proof()}

    def close(self):
        self.embedding_table = None
        self.weights = None

    def _encode_one(self, text, cancellation_check=None):
        self._raise_if_cancelled(cancellation_check)
        encoded = self.tokenizer(
            text,
            add_special_tokens=True,
            return_attention_mask=True,
            truncation=True,
            max_length=self.sequence_lengths[-1],
        )
        token_ids = encoded["input_ids"]
        token_count = len(token_ids)
        sequence_length = next(
            (length for length in self.sequence_lengths if token_count <= length),
            None,
        )
        if sequence_length is None:
            raise RuntimeError(f"input requires {token_count} tokens, above compiled variants")
        hidden = np.zeros((sequence_length, self.config.hidden_size), dtype=bfloat16)
        token_tensor = self.embedding_table[token_ids].float().numpy().astype(bfloat16)
        hidden[:token_count] = token_tensor
        mask = self._attention_mask(sequence_length, token_count)
        rope_q = self._rope_lookup(sequence_length, self.config.num_attention_heads)
        rope_k = self._rope_lookup(sequence_length, self.config.num_key_value_heads)
        for layer in range(self.config.num_hidden_layers):
            self._raise_if_cancelled(cancellation_check)
            hidden = self._attention_layer(
                hidden, mask, rope_q, rope_k, layer, cancellation_check
            )
            self._raise_if_cancelled(cancellation_check)
            hidden = self._mlp_layer(hidden, layer)
        self._raise_if_cancelled(cancellation_check)
        hidden = self.ops.normalize(hidden, self._weight("norm.weight"))
        return hidden[token_count - 1].astype(np.float32)

    def _attention_layer(
        self, hidden, mask, rope_q, rope_k, layer, cancellation_check=None
    ):
        prefix = f"layers.{layer}"
        residual = hidden
        normalized = self.ops.normalize(
            hidden, self._weight(f"{prefix}.input_layernorm.weight")
        )
        query = self.ops.matmul(
            normalized, self._weight(f"{prefix}.self_attn.q_proj.weight").T
        )
        key = self.ops.matmul(
            normalized, self._weight(f"{prefix}.self_attn.k_proj.weight").T
        )
        value = self.ops.matmul(
            normalized, self._weight(f"{prefix}.self_attn.v_proj.weight").T
        )
        query = self._head_norm_and_rope(
            query,
            self.config.num_attention_heads,
            self._weight(f"{prefix}.self_attn.q_norm.weight"),
            rope_q,
        )
        key = self._head_norm_and_rope(
            key,
            self.config.num_key_value_heads,
            self._weight(f"{prefix}.self_attn.k_norm.weight"),
            rope_k,
        )
        value = self._to_heads(value, self.config.num_key_value_heads)
        repeats = self.config.num_attention_heads // self.config.num_key_value_heads
        key = np.repeat(key, repeats, axis=0)
        value = np.repeat(value, repeats, axis=0)
        contexts = []
        scale = np.full(mask.shape, 1.0 / math.sqrt(self.config.head_dim), dtype=bfloat16)
        for head in range(self.config.num_attention_heads):
            self._raise_if_cancelled(cancellation_check)
            scores = self.ops.matmul(query[head], key[head].T)
            scores = self.ops.mul(scores, scale, "attention-scale")
            scores = self.ops.add(scores, mask)
            probabilities = self.ops.softmax(scores)
            contexts.append(self.ops.matmul(probabilities, value[head]))
        context = np.stack(contexts, axis=1).reshape(hidden.shape[0], -1)
        attention = self.ops.matmul(
            context, self._weight(f"{prefix}.self_attn.o_proj.weight").T
        )
        return self.ops.add(residual, attention)

    def _mlp_layer(self, hidden, layer):
        prefix = f"layers.{layer}"
        residual = hidden
        normalized = self.ops.normalize(
            hidden, self._weight(f"{prefix}.post_attention_layernorm.weight")
        )
        gate = self.ops.matmul(
            normalized, self._weight(f"{prefix}.mlp.gate_proj.weight").T
        )
        up = self.ops.matmul(
            normalized, self._weight(f"{prefix}.mlp.up_proj.weight").T
        )
        activated = self.ops.activation(gate)
        gated = self.ops.mul(activated, up, "swiglu")
        down = self.ops.matmul(
            gated, self._weight(f"{prefix}.mlp.down_proj.weight").T
        )
        return self.ops.add(residual, down)

    def _head_norm_and_rope(self, values, head_count, weight, lookup):
        heads = self._to_heads(values, head_count)
        shape = heads.shape
        flattened = heads.reshape(shape[0] * shape[1], shape[2])
        normalized = self.ops.normalize(flattened, weight)
        rotated = self.ops.apply_rope(normalized, lookup)
        return rotated.reshape(shape)

    def _to_heads(self, values, head_count):
        sequence_length = values.shape[0]
        return values.reshape(sequence_length, head_count, self.config.head_dim).transpose(1, 0, 2)

    def _rope_lookup(self, sequence_length, head_count):
        dimensions = self.config.head_dim // 2
        frequency = 1.0 / (
            self.config.rope_theta
            ** (np.arange(dimensions, dtype=np.float32) * 2.0 / self.config.head_dim)
        )
        angles = np.arange(sequence_length, dtype=np.float32)[:, None] * frequency[None, :]
        lookup = np.empty((sequence_length, self.config.head_dim), dtype=np.float32)
        lookup[:, :dimensions] = np.cos(angles)
        lookup[:, dimensions:] = np.sin(angles)
        return np.tile(lookup[None, :, :], (head_count, 1, 1)).reshape(-1, self.config.head_dim).astype(bfloat16)

    @staticmethod
    def _attention_mask(sequence_length, token_count):
        mask = np.zeros((sequence_length, sequence_length), dtype=np.float32)
        mask[np.triu_indices(sequence_length, 1)] = -10000.0
        mask[:, token_count:] = -10000.0
        return mask.astype(bfloat16)

    def _weight(self, name):
        return self.weights.get_tensor(name).float().numpy().astype(bfloat16)

    def _validate_model_shape(self):
        expected = (1024, 3072, 28, 16, 8, 128)
        actual = (
            self.config.hidden_size,
            self.config.intermediate_size,
            self.config.num_hidden_layers,
            self.config.num_attention_heads,
            self.config.num_key_value_heads,
            self.config.head_dim,
        )
        if actual != expected:
            raise RuntimeError(f"unsupported Phoenix Qwen model shape: {actual}")

    @staticmethod
    def _raise_if_cancelled(cancellation_check):
        if cancellation_check is not None and cancellation_check():
            raise InterruptedError("embedding request cancelled")


def create_encoder(spec, manifest, runtime_config):
    return AmdPhoenixQwenEncoder(spec, manifest, runtime_config)
