import pymupdf


def make_pdf(pages: int = 2, text: bool = True, password: str | None = None,
             size: tuple[float, float] = (595, 842), rotation: int = 0) -> bytes:
    doc = pymupdf.open()
    for i in range(pages):
        page = doc.new_page(width=size[0], height=size[1])
        if text:
            page.insert_text((72, 72), f"Page {i}", fontsize=14)
        if rotation:
            page.set_rotation(rotation)
    if password:
        return doc.tobytes(encryption=pymupdf.PDF_ENCRYPT_AES_256, owner_pw=password, user_pw=password)
    return doc.tobytes()
