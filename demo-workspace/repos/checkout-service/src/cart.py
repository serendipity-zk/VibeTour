from dataclasses import dataclass


@dataclass(frozen=True)
class CartItem:
    sku: str
    quantity: int
