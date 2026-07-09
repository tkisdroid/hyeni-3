package com.hyeni.calendar;

import static org.junit.Assert.assertEquals;

import com.hyeni.calendar.RegisteredPlaceResolver.PlaceCandidate;

import org.junit.Test;

import java.util.Arrays;
import java.util.List;

public class RegisteredPlaceResolverTest {

    @Test
    public void canonicalize_mergesSamePhysicalPlaceAndPrefersSavedPlace() {
        PlaceCandidate saved = new PlaceCandidate(
                "registered:saved_place:c274",
                "태권도 학원",
                "saved_place",
                37.32858118076739,
                127.11420308385253);
        PlaceCandidate academy = new PlaceCandidate(
                "registered:academy:a9b9",
                "태권도",
                "academy",
                37.32863289741469,
                127.11429906950715);

        List<PlaceCandidate> out = RegisteredPlaceResolver.canonicalize(Arrays.asList(academy, saved));

        assertEquals(1, out.size());
        assertEquals("registered:saved_place:c274", out.get(0).placeKey);
        assertEquals("태권도 학원", out.get(0).name);
    }

    @Test
    public void canonicalize_keepsAdjacentBuildingsSeparate() {
        PlaceCandidate piano = new PlaceCandidate(
                "registered:saved_place:piano",
                "피아노 학원",
                "saved_place",
                37.32905577788697,
                127.11492311155779);
        PlaceCandidate taekwondo = new PlaceCandidate(
                "registered:saved_place:taekwondo",
                "태권도 학원",
                "saved_place",
                37.32858118076739,
                127.11420308385253);

        List<PlaceCandidate> out = RegisteredPlaceResolver.canonicalize(Arrays.asList(piano, taekwondo));

        assertEquals(2, out.size());
    }
}
