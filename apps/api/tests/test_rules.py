import pymupdf

from edith.rules import Rules, Segment, page_rules


def rules_of(draw) -> Rules:
    doc = pymupdf.open()
    draw(doc.new_page(width=595, height=842))
    return page_rules(pymupdf.open(stream=doc.tobytes(), filetype="pdf")[0])


def spans(segments: list[Segment]) -> list[tuple]:
    return sorted((round(s.at, 2), round(s.lo, 2), round(s.hi, 2)) for s in segments)


def test_strokes_box_sides_and_thin_bars_are_rules():
    def draw(pg):
        pg.draw_line((50, 100), (300, 100))
        pg.draw_line((200, 50), (200, 150))
        pg.draw_rect(pymupdf.Rect(50, 200, 150, 260))
        pg.draw_rect(pymupdf.Rect(50, 300, 250, 301.5), color=None, fill=(0, 0, 0))  # a 1.5 pt filled bar
    r = rules_of(draw)
    assert spans(r.horizontal) == [(100, 50, 300), (200, 50, 150), (260, 50, 150), (300.75, 50, 250)]
    assert spans(r.vertical) == [(50, 200, 260), (150, 200, 260), (200, 50, 150)]


def test_ticks_curves_and_filled_polygons_are_not_rules():
    def draw(pg):
        pg.draw_line((50, 100), (58, 100))  # 8 pt: a tick or a checkbox side
        pg.draw_circle((300, 300), 40)
        pg.draw_polyline([(100, 400), (112, 400), (112, 430), (130, 430), (130, 442), (100, 442)],
                         closePath=True, fill=(0, 0, 0))  # an "L" drawn as a glyph outline
    r = rules_of(draw)
    assert r.horizontal == [] and r.vertical == []


def test_between_queries():
    r = Rules(horizontal=[Segment(100, 50, 300)], vertical=[Segment(200, 50, 150)])
    assert r.h_between(90, 110, 100, 120)
    assert not r.h_between(90, 110, 310, 400)   # beside the rule
    assert not r.h_between(101, 110, 60, 70)    # below it
    assert r.v_between(190, 210, 90, 110)
    assert not r.v_between(190, 210, 160, 170)  # the rule ends above
    assert not r.v_between(201, 210, 90, 110)
