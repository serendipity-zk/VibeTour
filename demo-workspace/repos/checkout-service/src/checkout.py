"""Checkout orchestration for the nested-repository demo."""

from cart import CartItem
from inventory import Inventory


class CheckoutService:
    def __init__(self, inventory: Inventory):
        self.inventory = inventory

    def checkout(self, item: CartItem) -> str:
        if not self.inventory.can_reserve(item.sku, item.quantity):
            return "out-of-stock"
        self.inventory.reserve(item.sku, item.quantity)
        return "confirmed"
