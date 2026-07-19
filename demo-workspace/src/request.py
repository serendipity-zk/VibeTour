from dataclasses import dataclass


@dataclass
class Request:
    request_id: str
    required_blocks: int
