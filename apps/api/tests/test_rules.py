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
                         closePath=True, fill=(0, 0, 0), color=None)  # an "L" drawn as a glyph outline
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


def test_filled_triangle_arrow_and_pentagon_are_not_rules():
    def draw(pg):
        pg.draw_polyline([(100, 100), (160, 100), (130, 140)], closePath=True, fill=(0, 0, 0), color=None)  # triangle
        pg.draw_polyline([(200, 100), (260, 100), (260, 130), (280, 130), (230, 160), (200, 130)],
                         closePath=True, fill=(0, 0, 0), color=None)  # arrow
        pg.draw_polyline([(300, 100), (360, 100), (370, 130), (330, 160), (290, 130)],
                         closePath=True, fill=(0, 0, 0), color=None)  # pentagon
        pg.draw_polyline([(400, 100), (460, 100), (460, 140), (430, 140)], closePath=True, fill=(0, 0, 0), color=None)  # trapezoid-ish
    r = rules_of(draw)
    assert r.horizontal == [] and r.vertical == []


def test_filled_rect_polygon_still_counts_as_a_bar():
    def draw(pg):
        pg.draw_polyline([(50, 300), (250, 300), (250, 301.5), (50, 301.5)], closePath=True, fill=(0, 0, 0), color=None)
    r = rules_of(draw)
    assert spans(r.horizontal) == [(300.75, 50, 250)] and r.vertical == []


def test_fill_and_stroke_non_rect_keeps_its_stroke_segments():
    def draw(pg):
        # an outlined L-shaped table cell group, filled and stroked
        pg.draw_polyline([(100, 100), (200, 100), (200, 150), (150, 150), (150, 200), (100, 200)],
                         closePath=True, fill=(0.9, 0.9, 0.9), color=(0, 0, 0))
    r = rules_of(draw)
    assert spans(r.horizontal) == [(100, 100, 200), (150, 150, 200), (200, 100, 150)]
    assert spans(r.vertical) == [(100, 100, 200), (150, 150, 200), (200, 100, 150)]


def test_fill_and_stroke_rect_is_one_box():
    def draw(pg):
        pg.draw_rect(pymupdf.Rect(50, 200, 150, 260), fill=(0.9, 0.9, 0.9), color=(0, 0, 0))
    r = rules_of(draw)
    assert spans(r.horizontal) == [(200, 50, 150), (260, 50, 150)]
    assert spans(r.vertical) == [(50, 200, 260), (150, 200, 260)]


def test_identical_segments_are_deduplicated():
    r = Rules(horizontal=[Segment(100, 50, 300), Segment(100, 50, 300)], vertical=[Segment(5, 1, 20)] * 3)
    assert len(r.horizontal) == 1 and len(r.vertical) == 1


def test_collinear_segments_with_small_gaps_are_one_rule():
    """Word draws table borders row by row with 0.5 pt gaps: a test at the gap must still find the rule."""
    r = Rules(vertical=[Segment(308.0, 300.0, 321.2), Segment(308.05, 321.7, 335.0), Segment(308.0, 340.0, 360.0)],
              horizontal=[Segment(100, 50, 120), Segment(100, 120.8, 300)])
    assert spans(r.vertical) == [(308.0, 300.0, 335.0), (308.0, 340.0, 360.0)]  # a 5 pt gap stays a gap
    assert spans(r.horizontal) == [(100, 50, 300)]
    assert r.v_between(300, 320, 318, 325)  # the middle of 318 … 325 lies in the old 0.5 pt gap
