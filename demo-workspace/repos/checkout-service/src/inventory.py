"""Inventory owned by the nested checkout-service repository."""


class Inventory:
    def __init__(self, available: dict[str, int]):
        self.available = available

    def can_reserve(self, sku: str, quantity: int) -> bool:
        return self.available.get(sku, 0) >= quantity

    def reserve(self, sku: str, quantity: int) -> None:
        if not self.can_reserve(sku, quantity):
            raise ValueError("insufficient inventory")
        self.available[sku] -= quantity
