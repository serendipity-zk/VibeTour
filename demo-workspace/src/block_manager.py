"""Capacity accounting for the demo scheduler."""


class BlockManager:
    def __init__(self, free_blocks: int):
        self.free_blocks = free_blocks

    def can_allocate(self, required_blocks: int) -> bool:
        """Admission is all-or-nothing in this simplified example."""
        return required_blocks <= self.free_blocks
